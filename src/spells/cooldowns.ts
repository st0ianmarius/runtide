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
}

/** When cooldowns land: as a cast starts, as it releases, or all at once (a press that commits them). */
export type CooldownMoment = 'start' | 'release' | 'all';

/** No cooldowns. */
const NONE: readonly never[] = Object.freeze([]);

/** Resolves one cooldown against the aura registry, checked. */
const compileOne = <G extends SpellTypes>(
  auras: AuraSystem<G>,
  cooldown: SpellCooldown<G>,
  name: string,
): CompiledCooldown<G> => {
  const { seconds, startsOn } = cooldown;

  if (typeof seconds === 'number' && !(seconds >= 0 && Number.isFinite(seconds))) {
    throw new RangeError(`Spell ${name}: its cooldown lasts a finite number of seconds from 0.`);
  }

  if (startsOn !== undefined && startsOn !== 'start' && startsOn !== 'release') {
    throw new RangeError(`Spell ${name}: a cooldown starts on 'start' or 'release'.`);
  }

  const ids: Readonly<Record<string, AuraId | undefined>> = auras.registry.id;
  const id = typeof cooldown.aura === 'string' ? ids[cooldown.aura] : cooldown.aura;

  if (id === undefined || id < 0 || id >= auras.registry.size || auras.registry.isRetired(id)) {
    throw new RangeError(`Spell ${name}: its cooldown aura ${cooldown.aura} is not a live aura.`);
  }

  return Object.freeze({ aura: id, seconds, onRelease: startsOn === 'release' });
};

/** Whether a spell names a list of cooldowns, not one. */
const isList = <G extends SpellTypes>(
  cooldown: SpellCooldown<G> | readonly SpellCooldown<G>[],
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
  name: string,
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
  readonly #application = new CooldownApplication();

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

      if (cooldown !== undefined && this.#auras.has(caster, cooldown.aura)) {
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

      most = cooldown === undefined ? most : Math.max(most, this.#auras.remaining(caster, cooldown.aura));
    }

    return most;
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

  /** Lands a cast's cooldowns of a moment on its caster, each for its seconds read from the cast, in order. */
  start(cast: Cast<G>, moment: CooldownMoment): void {
    const list = this.of(cast.spell);

    for (let i = 0; i < list.length; i++) {
      const cooldown = list[i];

      if (cooldown !== undefined && (moment === 'all' || cooldown.onRelease === (moment === 'release'))) {
        const { seconds } = cooldown;

        this.#land(cast.caster, cooldown.aura, typeof seconds === 'function' ? seconds(cast) : seconds);
      }
    }
  }

  /** Lands every cooldown of a spell none of whose seconds read a cast (`readsCast` is false), in order. */
  startConstant(caster: G['bearer'], spell: number): void {
    const list = this.of(spell);

    for (let i = 0; i < list.length; i++) {
      const cooldown = list[i];

      if (cooldown !== undefined && typeof cooldown.seconds !== 'function') {
        this.#land(caster, cooldown.aura, cooldown.seconds);
      }
    }
  }

  /** Lands one cooldown aura for some seconds, or its own duration. */
  #land(caster: G['bearer'], aura: AuraId, seconds: number | undefined): void {
    const application = this.#application;

    application.aura = aura;
    application.duration = seconds;
    this.#auras.apply(caster, application);
  }
}
