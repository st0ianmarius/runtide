// Hot path: a press is checked on every motion step, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { AuraTagId } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityBearer, AbilityTypes, ButtonRefusal, PressRefusal, SlotId } from './ability-types.ts';
import type { CompiledButton } from './buttons.ts';
import type { AbilityEngine } from './engine.ts';
import { loadoutOf, type LoadoutRecord } from './loadout.ts';

/** The spell in a loadout's slot, or `undefined` for an empty one. */
export const spellAt = (record: LoadoutRecord, slot: number): SpellId | undefined => {
  const spell = record.spells[slot] ?? -1;

  return spell < 0 ? undefined : toId<'spells'>(spell);
};

/** Whether a bearer holds every tag of a list (`every`) or any of them. */
const holds = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  [tags, every]: readonly [readonly AuraTagId[], boolean]
): boolean => {
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];

    if (tag !== undefined && engine.auras.hasTag(bearer, tag) !== every) {
      return !every;
    }
  }

  return every;
};

/** Which of a button's own rules fails on a bearer: its required tags, its blocking tags, its cost. */
const failedRule = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
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

/** Whether a bearer holds one of a button spell's cooldowns. */
const isCooling = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
): boolean => {
  const { cooldowns } = button;

  for (let i = 0; i < cooldowns.length; i++) {
    const aura = cooldowns[i];

    if (aura !== undefined && engine.auras.has(bearer, aura)) {
      return true;
    }
  }

  return false;
};

/**
 * Why the ability in a slot may not fire now, or `undefined` when it may: the slot holds none (`empty`), one of its
 * spell's cooldowns is on the bearer (`cooldown`), or one of the button's own rules fails. Reads only the bearer, so a
 * server and a prediction mirror agree.
 */
export const refusalAt = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  slot: number
): ButtonRefusal | undefined => {
  const spell = spellAt(loadoutOf(bearer), slot);
  const button = spell === undefined ? undefined : engine.buttons[spell];

  if (spell === undefined || button === undefined) {
    return 'empty';
  }

  return isCooling(engine, bearer, button) ? 'cooldown' : failedRule(engine, bearer, button);
};

/** Asks a button's `checkCast` with a `MirrorCtx` of the press; true for a button with none. */
const passesCheck = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  spell: SpellId
): boolean => {
  const check = engine.buttons[spell]?.def.checkCast;

  return check === undefined || check(engine.mirrorFor(bearer, spell));
};

/** Pays a button's cost; false when the bearer can no longer pay it. */
const pay = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
): boolean =>
  button.costAura < 0 || engine.auras.spendStacks(bearer, toId<'auras'>(button.costAura), button.costStacks);

/**
 * Commits a press of a button: pays its cost, runs `activate`, starts its spell's cooldowns when it commits at the
 * press (and on a prediction mirror, whose casts never start, as the cast would: release ones after the windup), lands its `applies` in order, then clears its `resets`. A prediction mirror lands only the `predicted` auras
 * of `applies`: the rest touch nothing it steps, and its seed replaces predicted auras alone, so it would keep them.
 * `cooldown` when an earlier slot of the same press started a cooldown it shares (a global cooldown, a category), and
 * `cost` when one spent what it needed.
 */
const commit = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  [spell, button]: readonly [SpellId, CompiledButton<G>]
): ButtonRefusal | undefined => {
  if (isCooling(engine, bearer, button)) {
    return 'cooldown';
  }

  if (!pay(engine, bearer, button)) {
    return 'cost';
  }

  button.def.activate?.(engine.mirrorFor(bearer, spell));

  if (!button.commitsOnCast) {
    engine.spells.startCooldowns(bearer, spell, engine.options);
  } else if (engine.isMirror) {
    engine.spells.predictCooldowns(bearer, spell, engine.options);
  }

  const { auras } = engine;

  for (let i = 0; i < button.applies.length; i++) {
    const aura = button.applies[i];

    if (aura !== undefined && (!engine.isMirror || auras.isPredicted(aura))) {
      auras.apply(bearer, aura);
    }
  }

  for (let i = 0; i < button.resets.length; i++) {
    const tag = button.resets[i];

    if (tag !== undefined) {
      auras.removeByTag(bearer, tag);
    }
  }

  return undefined;
};

/**
 * Casts a committed press's spell, or on a prediction mirror fires only its cast cue. A cast the server's cast order
 * refused all the same leaves its refusal on the engine.
 */
const castCommitted = <G extends AbilityTypes>(engine: AbilityEngine<G>, bearer: G['bearer'], spell: SpellId): void => {
  if (engine.isMirror) {
    engine.spells.predictCast(bearer, spell, engine.options);

    return;
  }

  const report = engine.spells.cast(bearer, spell, engine.options);

  engine.refusal = report.status === 'refused' ? report.refusal : undefined;
};

/**
 * Why a button may not commit, asked before anything is: its `checkCast`, then, for a button that commits on its
 * cast, the server's cast order (a prediction mirror, which cannot ask it, leaves a button with no `checkCast` to the
 * server). `undefined` when it may.
 */
const admission = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  [spell, button]: readonly [SpellId, CompiledButton<G>]
): PressRefusal<G> | undefined => {
  if (!passesCheck(engine, bearer, spell)) {
    return 'check';
  }

  if (!button.commitsOnCast) {
    return undefined;
  }

  if (engine.isMirror) {
    return button.def.checkCast === undefined ? 'server' : undefined;
  }

  return engine.spells.check(bearer, spell, engine.options);
};

/**
 * Fires the ability in a slot, already decided against its rules: asks its `checkCast`, then, for a button that
 * commits on its cast, the cast order (the server's; a prediction mirror cannot ask it, so it commits only what a
 * `checkCast` judged and leaves a button with none to the server); then commits and casts, with the cooldowns marked
 * started for a press that committed them. Whether it committed; why not, or why its cast was refused, on the engine.
 */
const fire = <G extends AbilityTypes>(engine: AbilityEngine<G>, bearer: G['bearer'], slot: number): boolean => {
  const record = loadoutOf(bearer);
  const spell = spellAt(record, slot);
  const button = spell === undefined ? undefined : engine.buttons[spell];
  const { options } = engine;

  if (spell === undefined || button === undefined) {
    return engine.refuse('empty');
  }

  options.input = engine.input;
  options.key = engine.key;
  options.rank = record.ranks[slot] ?? 1;

  const refused = admission(engine, bearer, [spell, button]) ?? commit(engine, bearer, [spell, button]);

  if (refused !== undefined) {
    return engine.refuse(refused);
  }

  engine.refusal = undefined;
  options.committed = !button.commitsOnCast;
  castCommitted(engine, bearer, spell);
  options.committed = false;

  return true;
};

/**
 * A press with the input and key in `engine.input` and `engine.key`: decides every pressed slot against the bearer as
 * it stands before any fires, so a dodge and an ability that resets the dodge's cooldown on one press both fire, then
 * fires them in slot order. Returns the mask of the slots that fired (committed), and writes each pressed slot's
 * refusal, if any, into `engine.refusals` by slot.
 */
export const press = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  pressed: number
): number => {
  const count = engine.slots.size;
  const { refusals } = engine;
  let accepted = 0;

  for (let slot = 0; slot < count && pressed !== 0; slot++) {
    const bit = 1 << slot;
    const refusal = (pressed & bit) === 0 ? undefined : refusalAt(engine, bearer, slot);

    if (refusals !== undefined) {
      refusals[slot] = refusal;
    }

    accepted |= (pressed & bit) !== 0 && refusal === undefined ? bit : 0;
  }

  for (let slot = 0; slot < count && accepted !== 0; slot++) {
    const bit = 1 << slot;

    if ((accepted & bit) !== 0) {
      accepted &= fire(engine, bearer, slot) ? ~0 : ~bit;

      if (refusals !== undefined) {
        refusals[slot] = engine.refusal;
      }
    }
  }

  engine.input = undefined;
  engine.refusals = undefined;
  engine.key = 0;
  engine.options.input = undefined;
  engine.refusal = undefined;

  return accepted;
};

/** The first slot of a bearer's loadout holding a spell, or `undefined`. */
export const slotHolding = (bearer: AbilityBearer, spell: SpellId): SlotId | undefined => {
  const index = loadoutOf(bearer).spells.indexOf(spell);

  return index < 0 ? undefined : toId<'slots'>(index);
};
