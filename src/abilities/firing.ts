// Hot path: a press is checked on every motion step, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { AuraTagId } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import { evaluateScaled } from '../modifiers/index.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityBearer, AbilityTypes, ButtonRefusal, SlotId } from './ability-types.ts';
import type { CompiledButton } from './buttons.ts';
import type { AbilityEngine } from './engine.ts';
import { loadoutOf, type LoadoutRecord } from './loadout.ts';

/** The spell in a loadout's slot, or `undefined` for an empty one. */
export const spellAt = (record: LoadoutRecord, slot: number): SpellId | undefined => {
  const spell = record.spells[slot] ?? -1;

  return spell < 0 ? undefined : toId<'spells'>(spell);
};

/**
 * A button's cooldown in seconds for a caster at a rank: its number, its function of the caster, or its
 * scaled value over the caster's stats for the spell. With no caster (a preview) a scaled value reads the stat table's
 * bases, and a function is NaN. 0 when it has none.
 */
export const cooldownSeconds = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  caster: G['bearer'] | undefined,
  [spell, rank]: readonly [SpellId, number],
): number => {
  const cooldown = engine.buttons[spell]?.cooldown;

  if (cooldown === undefined || typeof cooldown === 'number') {
    return cooldown ?? 0;
  }

  if (typeof cooldown === 'function') {
    return caster === undefined ? Number.NaN : cooldown(caster, rank);
  }

  return evaluateScaled(cooldown, { caster: engine.viewOf(caster, spell), rank });
};

/** Whether a bearer holds every tag of a list (`every`) or any of them. */
const holds = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  [tags, every]: readonly [readonly AuraTagId[], boolean],
): boolean => {
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];

    if (tag !== undefined && engine.auras.hasTag(bearer, tag) !== every) {
      return !every;
    }
  }

  return every;
};

/** Which of a button's own rules a caster fails: a `requires` tag missing, a `blockedBy` tag held, its cost unpaid. */
const failedRule = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>,
): ButtonRefusal | undefined => {
  if (button.requires.length > 0 && !holds(engine, bearer, [button.requires, true])) {
    return 'requires';
  }

  if (button.blockedBy.length > 0 && holds(engine, bearer, [button.blockedBy, false])) {
    return 'blocked';
  }

  return button.costAura >= 0 && engine.auras.stacks(bearer, toId<'auras'>(button.costAura)) < button.costStacks
    ? 'cost'
    : undefined;
};

/** Whether a slot's cooldown aura is on its bearer. */
const isCooling = <G extends AbilityTypes>(engine: AbilityEngine<G>, bearer: G['bearer'], slot: number): boolean => {
  const aura = engine.cooldowns[slot] ?? -1;

  return aura >= 0 && engine.auras.has(bearer, toId<'auras'>(aura));
};

/**
 * Why the ability in a slot may not fire now, or `undefined` when it may: the slot holds none (`empty`),
 * its cooldown aura is on the bearer (`cooldown`), or one of the ability's own rules fails. Reads only the bearer, so a
 * server and a prediction mirror agree.
 */
export const refusalAt = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  slot: number,
): ButtonRefusal | undefined => {
  const spell = spellAt(loadoutOf(bearer), slot);
  const button = spell === undefined ? undefined : engine.buttons[spell];

  if (button === undefined) {
    return 'empty';
  }

  return isCooling(engine, bearer, slot) ? 'cooldown' : failedRule(engine, bearer, button);
};

/** Starts a slot's cooldown for the ability in it: its cooldown aura for the seconds read now; none for 0 or less. */
const startCooldown = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  [slot, spell, rank]: readonly [number, SpellId, number],
): void => {
  const aura = engine.cooldowns[slot] ?? -1;
  const seconds = aura < 0 ? 0 : cooldownSeconds(engine, bearer, [spell, rank]);

  if (seconds > 0) {
    engine.auras.apply(bearer, { aura: toId<'auras'>(aura), duration: seconds });
  }
};

/**
 * What a button lands on its caster as it fires, after its cost, motion and cooldown: its `applies` in order (each
 * for its aura's own length), then its `resets`.
 */
const land = <G extends AbilityTypes>(engine: AbilityEngine<G>, bearer: G['bearer'], spell: SpellId): void => {
  const button = engine.buttons[spell];

  if (button === undefined) {
    return;
  }

  const { auras } = engine;

  for (let i = 0; i < button.applies.length; i++) {
    const aura = button.applies[i];

    if (aura !== undefined) {
      auras.apply(bearer, aura);
    }
  }

  for (const tag of button.resets) {
    auras.removeByTag(bearer, tag);
  }
};

/**
 * Casts a button's spell with an input at a rank and the press's key; whether the cast was refused. On a prediction
 * mirror it fires only the spell's cast cue (`spells.predictCast`) and counts as refused, so no `cast` cooldown starts
 * there: the mirror takes that one from the wire.
 */
const castButton = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  [spell, rank, input]: readonly [SpellId, number, G['input'] | undefined],
): boolean => {
  const { options } = engine;

  options.input = input;
  options.rank = rank;
  options.key = engine.key;

  let isRefused = true;

  if (engine.isMirror) {
    engine.spells.predictCast(bearer, spell, options);
  } else {
    isRefused = engine.spells.cast(bearer, spell, options).status === 'refused';
  }

  options.input = undefined;

  return isRefused;
};

/** Pays a button's cost; false when the bearer can no longer pay it. */
const pay = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>,
): boolean =>
  button.costAura < 0 || engine.auras.spendStacks(bearer, toId<'auras'>(button.costAura), button.costStacks);

/**
 * Fires the ability in a slot, already decided: pays its cost, runs `activate`, starts the slot's
 * cooldown (on `activation`), lands `applies` and `resets`, then casts its spell with the press's input, and starts
 * a `cast` cooldown once the cast was not refused. False when it could not fire (an empty slot, or a cost an earlier
 * slot of the same press spent).
 */
const fire = <G extends AbilityTypes>(engine: AbilityEngine<G>, bearer: G['bearer'], slot: number): boolean => {
  const { input } = engine;
  const record = loadoutOf(bearer);
  const spell = spellAt(record, slot);
  const button = spell === undefined ? undefined : engine.buttons[spell];

  if (spell === undefined || button === undefined || !pay(engine, bearer, button)) {
    return false;
  }

  const rank = record.ranks[slot] ?? 1;

  const { activate } = button.def;

  if (activate !== undefined) {
    const mirror = engine.mirrorFor(bearer, spell);

    mirror.input = input;
    mirror.dt = engine.dt;
    activate(mirror);
    mirror.input = undefined;
  }

  if (!button.isCastCooldown) {
    startCooldown(engine, bearer, [slot, spell, rank]);
  }

  land(engine, bearer, spell);

  if (!castButton(engine, bearer, [spell, rank, input]) && button.isCastCooldown) {
    startCooldown(engine, bearer, [slot, spell, rank]);
  }

  return true;
};

/**
 * A press with the input and key in `engine.input` and `engine.key`: decides every pressed slot against the bearer as it stands
 * before any fires, so a dodge and an ability that resets the dodge's cooldown on one press both fire, then fires them
 * in slot order. Returns the mask of the slots that fired.
 */
export const press = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  pressed: number,
): number => {
  const { input, key } = engine;
  const count = engine.slots.size;
  let accepted = 0;

  for (let slot = 0; slot < count && pressed !== 0; slot++) {
    const bit = 1 << slot;

    if ((pressed & bit) !== 0 && refusalAt(engine, bearer, slot) === undefined) {
      accepted |= bit;
    }
  }

  for (let slot = 0; slot < count && accepted !== 0; slot++) {
    const bit = 1 << slot;

    engine.input = input;
    engine.key = key;

    if ((accepted & bit) !== 0 && !fire(engine, bearer, slot)) {
      accepted &= ~bit;
    }
  }

  engine.input = undefined;
  engine.key = 0;

  return accepted;
};

/** The first slot of a bearer's loadout holding a spell, or `undefined`. */
export const slotHolding = (bearer: AbilityBearer, spell: SpellId): SlotId | undefined => {
  const index = loadoutOf(bearer).spells.indexOf(spell);

  return index < 0 ? undefined : toId<'slots'>(index);
};
