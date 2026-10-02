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

/** How many tags of a list a bearer holds. */
const heldTags = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  tags: readonly AuraTagId[]
): number => {
  let held = 0;

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];

    held += tag !== undefined && engine.auras.hasTag(bearer, tag) ? 1 : 0;
  }

  return held;
};

/** Which of a button's own rules fails on a bearer: its required tags, its blocking tags, its cost. */
const failedRule = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
): ButtonRefusal | undefined => {
  if (button.requires.length > 0 && heldTags(engine, bearer, button.requires) < button.requires.length) {
    return 'requires';
  }

  if (button.blockedBy.length > 0 && heldTags(engine, bearer, button.blockedBy) > 0) {
    return 'blocked';
  }

  return button.costAura >= 0 && engine.auras.stacks(bearer, toId<'auras'>(button.costAura)) < button.costStacks
    ? 'cost'
    : undefined;
};

/**
 * Why the ability in a slot may not fire now, or `undefined` when it may: the slot holds none (`empty`), one of its
 * spell's cooldowns is on the bearer (`cooldown`), or one of the button's own rules fails; a toggle held always may
 * (to take it off). Reads only the bearer, so a server and a prediction mirror agree.
 */
export const refusalAt = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  slot: number
): ButtonRefusal | undefined => refusalOf(engine, bearer, spellAt(loadoutOf(bearer), slot));

/** Why a spell's ability may not fire now on a bearer, or `undefined` when it may (see `refusalAt`). */
const refusalOf = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  spell: SpellId | undefined
): ButtonRefusal | undefined => {
  const button = spell === undefined ? undefined : engine.buttons[spell];

  if (spell === undefined || button === undefined) {
    return 'empty';
  }

  if (button.toggle >= 0 && engine.auras.has(bearer, toId<'auras'>(button.toggle))) {
    return undefined;
  }

  return engine.spells.isCooling(bearer, spell) ? 'cooldown' : failedRule(engine, bearer, button);
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
 * press (and on a prediction mirror, whose casts never start, as the cast would: release ones after the windup), clears
 * its `clears`, lands its `applies` in order, then clears its `resets`. A prediction mirror lands only the `predicted`
 * auras of `applies`: the rest touch nothing it steps, and its seed replaces predicted auras alone, so it would keep
 * them. `cooldown` when an earlier slot of the same press started a cooldown it shares (a global cooldown, a category),
 * and `cost` when one spent what it needed (or, for a button that commits on its cast, its cast's hooks did). On the
 * server a button that commits on its cast commits inside its cast, at `onAdmit`, where the cast order has already
 * refused a cooling spell: the cooldown read there is redundant, and harmless.
 */
const commit = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
): ButtonRefusal | undefined => {
  const { spell } = button;

  if (engine.spells.isCooling(bearer, spell)) {
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

  removeTags(engine, bearer, button.clears);

  for (let i = 0; i < button.applies.length; i++) {
    const aura = button.applies[i];

    if (aura !== undefined && (!engine.isMirror || auras.isPredicted(aura))) {
      auras.apply(bearer, aura);
    }
  }

  removeTags(engine, bearer, button.resets);

  return undefined;
};

/** Removes the caster's auras carrying each of some tags, in order. */
const removeTags = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  tags: readonly AuraTagId[]
): void => {
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];

    if (tag !== undefined) {
      engine.auras.removeByTag(bearer, tag);
    }
  }
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
 * The `onAdmit` of a cast that commits its button: commits the engine's `committing` button on the cast's caster once
 * the cast order admitted the cast; false, with the button's refusal on the engine, when it may not.
 */
const admitHookOf = <G extends AbilityTypes>(engine: AbilityEngine<G>) =>
  (engine.admitHook ??= (cast) => {
    const button = engine.committing;

    if (button === undefined) {
      return true;
    }

    const refused = commit(engine, cast.caster, button);

    if (refused !== undefined) {
      engine.admitRefusal = refused;

      return false;
    }

    engine.committing = undefined;

    return true;
  });

/**
 * Casts the spell of a button that commits on its cast, on the server: the cast order runs once, and its `onAdmit`
 * commits the button (pays, moves, lands its auras) after the reach and before `begin`, so a cast it refuses costs
 * nothing, and a cast `activate` moves out of reach is not refused after paying. Whether it committed; the refusal, the
 * button's own for one its commit made (`cost`, `cooldown`), the cast order's otherwise, on the engine.
 */
const castAdmitted = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
): boolean => {
  const { options } = engine;

  engine.committing = button;
  engine.admitRefusal = undefined;
  options.onAdmit = admitHookOf(engine);

  try {
    const report = engine.spells.cast(bearer, button.spell, options);
    const hasCommitted = engine.committing === undefined;
    const refusal = report.status === 'refused' ? report.refusal : undefined;

    engine.refusal = refusal === 'gate' ? (engine.admitRefusal ?? refusal) : refusal;

    return hasCommitted;
  } finally {
    options.onAdmit = undefined;
    engine.committing = undefined;
    engine.admitRefusal = undefined;
  }
};

/**
 * Why a button may not commit, asked before anything is: its `checkCast`, then, on a prediction mirror, which cannot
 * ask the server's cast order, `server` for a button that commits on its cast with no `checkCast` to judge it by.
 * `undefined` when it may (the server's cast order judges a button that commits on its cast as it casts).
 */
const admission = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
): PressRefusal<G> | undefined => {
  const { spell } = button;

  if (!passesCheck(engine, bearer, spell)) {
    return 'check';
  }

  return engine.isMirror && button.commitsOnCast && button.def.checkCast === undefined ? 'server' : undefined;
};

/**
 * Asks a decided button's `admission`, then commits and casts it: inside its cast on the server for one that commits on
 * its cast (`castAdmitted`), else commits, then casts with its cooldowns marked started for one that committed them.
 * Whether it committed; why not, or why its cast was refused, on the engine.
 */
const commitAndCast = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  button: CompiledButton<G>
): boolean => {
  const checked = admission(engine, bearer, button);

  if (checked !== undefined) {
    return engine.refuse(checked);
  }

  if (button.commitsOnCast && !engine.isMirror) {
    return castAdmitted(engine, bearer, button);
  }

  const refused = commit(engine, bearer, button);

  if (refused !== undefined) {
    return engine.refuse(refused);
  }

  const { options } = engine;

  engine.refusal = undefined;
  options.committed = !button.commitsOnCast;
  castCommitted(engine, bearer, button.spell);
  options.committed = false;

  return true;
};

/**
 * Fires the ability in a slot, already decided against its rules: asks its `checkCast`, then commits and casts. A
 * button that commits at the press commits, then casts with its cooldowns marked started. One that commits on its cast
 * casts on the server, and commits inside the cast once the cast order admits it (`castAdmitted`); a prediction mirror,
 * which cannot ask the cast order, commits it only on its `checkCast` and leaves one with none to the server. Whether
 * it committed; why not, or why its cast was refused, on the engine.
 */
const fire = <G extends AbilityTypes>(engine: AbilityEngine<G>, bearer: G['bearer'], slot: number): boolean => {
  const record = loadoutOf(bearer);
  const spell = spellAt(record, slot);
  const button = spell === undefined ? undefined : engine.buttons[spell];
  const { options } = engine;

  if (spell === undefined || button === undefined) {
    return engine.refuse('empty');
  }

  // An earlier slot's hook put another spell here (a weapon swap): it was never decided, so it is decided now.
  const swapped = spell === engine.decided()[slot] ? undefined : refusalOf(engine, bearer, spell);

  if (swapped !== undefined) {
    return engine.refuse(swapped);
  }

  if (button.toggle >= 0) {
    if (engine.auras.has(bearer, toId<'auras'>(button.toggle))) {
      engine.auras.remove(bearer, toId<'auras'>(button.toggle));
      engine.refusal = undefined;

      return true;
    }

    // Decided as held, so its rules went unasked: an earlier slot of this press took it off.
    const rule = failedRule(engine, bearer, button);

    if (rule !== undefined) {
      return engine.refuse(rule);
    }
  }

  const rank = record.ranks[slot] ?? 0;

  options.input = engine.input;
  options.key = engine.key;
  // 0: equipped with no rank, so the cast reads the caster's own (`host.rankOf`), else 1.
  options.rank = rank === 0 ? undefined : rank;

  // A press nested in `checkCast` or `activate` (a pet ordered along) gives all of this back as it found it.
  return commitAndCast(engine, bearer, button);
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
  const decided = engine.decided();
  const record = loadoutOf(bearer);
  let accepted = 0;

  for (let slot = 0; slot < count; slot++) {
    const bit = 1 << slot;
    const refusal = (pressed & bit) === 0 ? undefined : refusalAt(engine, bearer, slot);

    decided[slot] = record.spells[slot] ?? -1;

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

  engine.refusal = undefined;

  return accepted;
};

/** The first slot of a bearer's loadout holding a spell, or `undefined`. */
export const slotHolding = (bearer: AbilityBearer, spell: SpellId): SlotId | undefined => {
  const index = loadoutOf(bearer).spells.indexOf(spell);

  return index < 0 ? undefined : toId<'slots'>(index);
};
