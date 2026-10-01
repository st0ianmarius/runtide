// Cooldowns are asked on every cast, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { AuraApplication, AuraId, AuraSystem } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { CastSeconds } from './activation.ts';
import type { Cast } from './cast.ts';
import type { AnySpellDef, SpellCooldown } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/** One of a spell's cooldowns, resolved at load: its aura, its seconds, and whether it lands at the release. */
export interface CompiledCooldown<G extends SpellTypes> {
  /** The aura. */
  readonly aura: AuraId;

  /** Its seconds, read from the cast; the aura's own duration when absent. */
  readonly seconds: CastSeconds<G> | undefined;

  /** Whether it lands as the cast releases, not as it starts. */
  readonly onRelease: boolean;

  /** How many of its aura's stacks hold the spell: a number, or read from the caster at each check. */
  readonly charges: number | ((caster: G['bearer']) => number);
}

/** When cooldowns land: as a cast starts, as it releases, or all at once (a press that commits them). */
export type CooldownMoment = 'start' | 'release' | 'all';

/** No cooldowns. */
const NONE: readonly never[] = Object.freeze([]);

/** Throws unless a cooldown's charges are a whole number from 1. */
const checkCharges = (charges: number, name: string): void => {
  if (!Number.isInteger(charges) || charges < 1) {
    throw new RangeError(`Spell ${name}: a cooldown's charges are a whole number from 1; got ${charges}.`);
  }
};

/** Throws unless a cooldown's seconds, start and charges are sound. */
const checkNumbers = <G extends SpellTypes>(cooldown: SpellCooldown<G>, name: string): void => {
  const { seconds, startsOn, charges = 1 } = cooldown;

  if (typeof charges === 'number') {
    checkCharges(charges, name);
  }

  if (typeof seconds === 'number' && !(seconds >= 0 && Number.isFinite(seconds))) {
    throw new RangeError(`Spell ${name}: its cooldown lasts a finite number of seconds from 0.`);
  }

  if (startsOn !== undefined && startsOn !== 'start' && startsOn !== 'release') {
    throw new RangeError(`Spell ${name}: a cooldown starts on 'start' or 'release'.`);
  }
};

/** Resolves one cooldown against the aura registry, checked. */
const compileOne = <G extends SpellTypes>(
  auras: AuraSystem<G>,
  cooldown: SpellCooldown<G>,
  name: string
): CompiledCooldown<G> => {
  const { seconds, startsOn, charges = 1 } = cooldown;

  checkNumbers(cooldown, name);

  const ids: Readonly<Record<string, AuraId | undefined>> = auras.registry.id;
  const id = typeof cooldown.aura === 'string' ? ids[cooldown.aura] : cooldown.aura;

  if (id === undefined || id < 0 || id >= auras.registry.size || auras.registry.isRetired(id)) {
    throw new RangeError(`Spell ${name}: its cooldown aura ${cooldown.aura} is not a live aura.`);
  }

  return Object.freeze({ aura: id, seconds, onRelease: startsOn === 'release', charges });
};

/** A cooldown's charges for a caster now: its number, or what its function answers, checked. */
const chargesOf = <G extends SpellTypes>(caster: G['bearer'], cooldown: CompiledCooldown<G>): number => {
  const { charges } = cooldown;

  if (typeof charges === 'number') {
    return charges;
  }

  const read = charges(caster);

  checkCharges(read, 'with read charges');

  return read;
};

/** Whether a spell names a list of cooldowns, not one. */
const isList = <G extends SpellTypes>(
  cooldown: SpellCooldown<G> | readonly SpellCooldown<G>[]
): cooldown is readonly SpellCooldown<G>[] => Array.isArray(cooldown);

/** A spell's cooldowns as a list, whether it names none, one or several. */
export const cooldownList = <G extends SpellTypes>(def: AnySpellDef<G>): readonly SpellCooldown<G>[] => {
  const { cooldown } = def;

  if (cooldown === undefined) {
    return NONE;
  }

  return isList(cooldown) ? cooldown : [cooldown];
};

/** Resolves a spell's cooldowns against the aura registry at load; none for a spell without. */
export const compileCooldowns = <G extends SpellTypes>(
  auras: AuraSystem<G>,
  def: AnySpellDef<G> | undefined,
  name: string
): readonly CompiledCooldown<G>[] => {
  const list = def === undefined ? NONE : cooldownList(def);

  return list.length === 0 ? NONE : Object.freeze(list.map((one) => compileOne(auras, one, name)));
};

/** The application a spell's cooldown lands with, reused. */
class CooldownApplication implements AuraApplication {
  aura: AuraId = toId<'auras'>(0);
  duration: number | undefined = undefined;
}

/** A spell system's cooldowns: each spell's, and how they are asked and landed. */
export class Cooldowns<G extends SpellTypes> {
  readonly #auras: AuraSystem<G>;
  readonly #bySpell: readonly (readonly CompiledCooldown<G>[])[];
  readonly #applications: CooldownApplication[] = [];
  #depth = 0;

  constructor(auras: AuraSystem<G>, bySpell: readonly (readonly CompiledCooldown<G>[])[]) {
    this.#auras = auras;
    this.#bySpell = bySpell;
  }

  /** A spell's cooldowns, in the order it names them. */
  of(spell: number): readonly CompiledCooldown<G>[] {
    return this.#bySpell[spell] ?? NONE;
  }

  /** Whether a caster holds any of a spell's cooldowns. */
  isCooling(caster: G['bearer'], spell: number): boolean {
    const list = this.of(spell);

    for (let i = 0; i < list.length; i++) {
      const cooldown = list[i];

      if (cooldown !== undefined && this.#holds(caster, cooldown)) {
        return true;
      }
    }

    return false;
  }

  /** The seconds until a caster may cast a spell again: the most left on any of its cooldowns; 0 when none runs. */
  left(caster: G['bearer'], spell: number): number {
    const list = this.of(spell);
    let most = 0;

    for (let i = 0; i < list.length; i++) {
      const cooldown = list[i];

      if (cooldown !== undefined && this.#holds(caster, cooldown)) {
        most = Math.max(
          most,
          chargesOf(caster, cooldown) === 1
            ? this.#auras.remaining(caster, cooldown.aura)
            : this.#chargeLeft(caster, cooldown)
        );
      }
    }

    return most;
  }

  /**
   * The seconds until a charged cooldown frees a charge: until enough of its aura's instances run out, soonest first,
   * that the stacks left fall below its charges.
   */
  #chargeLeft(caster: G['bearer'], cooldown: CompiledCooldown<G>): number {
    const auras = this.#auras;
    const list = auras.list(caster);
    const charges = chargesOf(caster, cooldown);
    let held = auras.stacks(caster, cooldown.aura);
    let at = 0;

    while (held >= charges) {
      let next = Number.POSITIVE_INFINITY;
      let going = 0;

      for (const item of list) {
        const left = item.id === cooldown.aura ? auras.remainingOf(caster, item) : 0;

        if (left > at && left < next) {
          next = left;
          going = item.stacks;
        } else if (left > at && left === next) {
          going += item.stacks;
        }
      }

      if (going === 0) {
        return next === Number.POSITIVE_INFINITY ? auras.remaining(caster, cooldown.aura) : next;
      }

      held -= going;
      at = next;
    }

    return at;
  }

  /** Whether any of a spell's cooldowns reads its seconds from a cast (a function), so starting them needs one. */
  readsCast(spell: number): boolean {
    const list = this.of(spell);

    for (let i = 0; i < list.length; i++) {
      if (typeof list[i]?.seconds === 'function') {
        return true;
      }
    }

    return false;
  }

  /**
   * Lands a cast's cooldowns of a moment on its caster, each for its seconds read from the cast, in order; those that
   * start on the release `releaseAfter` seconds longer (a prediction of a cast's release).
   */
  start(cast: Cast<G>, moment: CooldownMoment, releaseAfter = 0): void {
    const list = this.of(cast.spell);

    for (let i = 0; i < list.length; i++) {
      const cooldown = list[i];

      if (cooldown !== undefined && (moment === 'all' || cooldown.onRelease === (moment === 'release'))) {
        const { seconds } = cooldown;

        this.#land(cast.caster, cooldown, typeof seconds === 'function' ? seconds(cast) : seconds, releaseAfter);
      }
    }
  }

  /**
   * Lands every cooldown of a spell none of whose seconds read a cast (`readsCast` is false), in order; those that
   * start on the release `releaseAfter` seconds longer.
   */
  startConstant(caster: G['bearer'], spell: number, releaseAfter = 0): void {
    const list = this.of(spell);

    for (let i = 0; i < list.length; i++) {
      const cooldown = list[i];

      if (cooldown !== undefined && typeof cooldown.seconds !== 'function') {
        this.#land(caster, cooldown, cooldown.seconds, releaseAfter);
      }
    }
  }

  /** Whether a cooldown holds its spell on a caster: its aura is on it, as many stacks as its charges. */
  #holds(caster: G['bearer'], cooldown: CompiledCooldown<G>): boolean {
    const charges = chargesOf(caster, cooldown);

    return charges === 1
      ? this.#auras.has(caster, cooldown.aura)
      : this.#auras.stacks(caster, cooldown.aura) >= charges;
  }

  /**
   * Lands one cooldown aura for some seconds, or its own duration; none for 0 seconds or less (a cooldown reduced to
   * nothing), which would hold the spell until the next step.
   */
  #land(caster: G['bearer'], cooldown: CompiledCooldown<G>, read: number | undefined, releaseAfter: number): void {
    // A cooldown read as nothing lands nothing, before its release as after it.
    if (read !== undefined && read <= 0) {
      return;
    }

    const seconds =
      cooldown.onRelease && releaseAfter > 0
        ? (read ?? this.#auras.lengthOf(cooldown.aura, caster)) + releaseAfter
        : read;

    if (seconds !== undefined && seconds <= 0) {
      return;
    }

    // An aura hook may cast another spell, landing its cooldowns while this application is still read: one per depth.
    const depth = this.#depth++;
    const application = (this.#applications[depth] ??= new CooldownApplication());

    application.aura = cooldown.aura;
    application.duration = seconds;

    try {
      this.#auras.apply(caster, application);
    } finally {
      this.#depth = depth;
    }
  }
}
