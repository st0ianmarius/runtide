import type { AuraId, AuraTagId } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityTypes, SlotId } from './ability-types.ts';
import { AbilityEngine, type AbilityParts } from './engine.ts';
import { type ButtonExplanation, explainButton } from './explain.ts';
import { canFire, cooldownSeconds, press, slotHolding, spellAt, travel, triggerButton } from './firing.ts';
import { loadoutOf, LoadoutRecord, type LoadoutState } from './loadout.ts';
import { createAbilityProcKinds } from './proc-kinds.ts';
import type { AbilityProcKinds } from './procs.ts';
import type { SlotTable } from './slots.ts';

/** A button spell equipped at a rank. */
export interface Equipped {
  /** The button spell. */
  readonly spell: SpellId;

  /** Its rank, from 1 to the spell's ranks; 1 when absent. */
  readonly rank?: number;
}

/** What a press reads and writes on its bearer (§II.6 R3): the auras and tags a prediction mirror must rebuild. */
export interface MirrorReads {
  /** The slots' cooldown auras, and every button's cost aura and applied auras, in id order. */
  readonly auras: readonly AuraId[];

  /** Every tag a button's `requires`, `blockedBy` or `resets` names, in id order. */
  readonly tags: readonly AuraTagId[];
}

/** What an ability system is built from (§I.5): the spell and aura systems, the game's slots, the caster's stats. */
export type AbilitySystemOptions<G extends AbilityTypes> = AbilityParts<G>;

/**
 * An ability system (§I.6 Abilities): buttons over a spell system. A unit's loadout puts a `button` spell in each slot;
 * a press fires the pressed slots whose ability may fire, each paying its cost, running its motion half, starting its
 * slot's cooldown aura, landing its auras, then casting its spell.
 */
export interface AbilitySystem<G extends AbilityTypes> {
  /** The game's slots. */
  readonly slots: SlotTable<G['slot']>;

  /** The proc kind `useAbility`: `createProcRegistry({ ...CORE_PROCS, ...abilities.procKinds })`. */
  readonly procKinds: AbilityProcKinds<G>;

  /**
   * The auras and tags a press reads and writes on its bearer: what a prediction mirror must rebuild, so each such aura
   * is `predicted` (`checkPredicted`).
   */
  readonly mirrorReads: MirrorReads;

  /** A new, empty loadout, for a unit with buttons (`AbilityBearer.loadout`). */
  readonly createLoadout: () => LoadoutState;

  /**
   * Puts a button spell in a slot (at rank 1, or at the rank given with it), or empties the slot (`undefined`).
   * Throws for a spell that is not a live button spell, a rank outside the spell's, or a spell with a cooldown on a
   * slot without one.
   */
  readonly equip: (bearer: G['bearer'], slot: SlotId, ability: SpellId | Equipped | undefined) => void;

  /** The spell in a slot; `undefined` for an empty one. */
  readonly abilityOf: (bearer: G['bearer'], slot: SlotId) => SpellId | undefined;

  /** The first slot holding a spell; `undefined` when it is not in the loadout (an area trigger's bound, §II.6 W1). */
  readonly slotOf: (bearer: G['bearer'], spell: SpellId) => SlotId | undefined;

  /** The press mask bit of a slot: a game builds a press from its input as `bit(dodge) | bit(skill)`. */
  readonly bit: (slot: SlotId) => number;

  /**
   * Whether the ability in a slot may fire now: the slot holds one, its cooldown aura is not on the bearer, every
   * `requires` tag is and no `blockedBy` tag is, and the cost is affordable. Reads only the bearer.
   */
  readonly canActivate: (bearer: G['bearer'], slot: SlotId) => boolean;

  /** The seconds left on a slot's cooldown; 0 when it is ready or has no cooldown. */
  readonly cooldownLeft: (bearer: G['bearer'], slot: SlotId) => number;

  /**
   * A press (§II.6 S4): every pressed slot (a mask of `bit`s) is decided against the bearer before any fires, then each
   * accepted one fires in slot order: pays its cost, runs `activate` (with a `MirrorCtx` of the press's input and the
   * clock's step), starts its slot's cooldown (on `activation`),
   * lands `applies` then `resets`, and casts its spell with `input` (a no-windup spell releases here, before the
   * bearer travels), starting a `cast` cooldown once the cast was not refused. Returns the mask of the slots that
   * fired. The game calls it inside its motion step, on the server and on a prediction mirror alike.
   */
  readonly tryActivate: (bearer: G['bearer'], pressed: number, input?: G['input']) => number;

  /**
   * The trigger path (§II.6 S4): fires a button spell with no slot cooldown (none gates it, none starts), gated by its
   * own rules; it pays, lands its auras and casts at the rank of the slot holding it. False when it did not fire.
   */
  readonly trigger: (bearer: G['bearer'], spell: SpellId, input?: G['input']) => boolean;

  /**
   * Runs every equipped ability's `travel` hook, in slot order, each with a `MirrorCtx` of the bearer, its stats for
   * the spell, the static world and `dt`: the motion half, after `tryActivate`.
   */
  readonly travel: (bearer: G['bearer'], dt: number) => void;

  /**
   * A button spell's cooldown in seconds at a rank (1 when absent), as it would start now: for a caster, read from its
   * stats; for none (`undefined`), a preview that needs no world (§II.6 M6), reading the stat table's bases, NaN for
   * a cooldown that is a function of the caster. 0 for none, or for a spell that is not a button.
   */
  readonly cooldownOf: (caster: G['bearer'] | undefined, spell: SpellId, rank?: number) => number;

  /**
   * A button spell's rules as data at a rank (1 when absent), for the client's tooltip (§II.6 M6): with a caster, its
   * cooldown's readings and total; with none, ratios only. `undefined` for a spell that is not a button.
   */
  readonly explain: (spell: SpellId, rank?: number, caster?: G['bearer']) => ButtonExplanation | undefined;
}

/** Throws unless a slot id is one of the table's. */
const checkSlot = (slots: SlotTable, slot: SlotId): void => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= slots.size) {
    throw new RangeError(`${slot} is not a slot of the game's ${slots.size}.`);
  }
};

/** Puts a spell in a slot, checked. */
const equipIn = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  bearer: G['bearer'],
  [slot, spell, rank]: readonly [SlotId, SpellId | undefined, number],
): void => {
  checkSlot(engine.slots, slot);

  const record = loadoutOf(bearer);

  if (spell === undefined) {
    record.spells[slot] = -1;
    record.ranks[slot] = 1;

    return;
  }

  const button = engine.buttons[spell];
  const { registry } = engine.spells;

  if (button === undefined) {
    throw new RangeError(`${spell} is not a live button spell.`);
  }

  if (!Number.isInteger(rank) || rank < 1 || rank > (registry.columns.ranks[spell] ?? 1)) {
    throw new RangeError(`${registry.name(spell)} has no rank ${rank}.`);
  }

  if (button.cooldown !== undefined && (engine.cooldowns[slot] ?? -1) < 0) {
    throw new RangeError(`${registry.name(spell)} has a cooldown, and slot ${engine.slots.name(slot)} has none.`);
  }

  record.spells[slot] = spell;
  record.ranks[slot] = rank;
};

/** The auras and tags an engine's presses read and write, sorted and without repeats. */
const mirrorReadsOf = <G extends AbilityTypes>(engine: AbilityEngine<G>): MirrorReads => {
  const auras = new Set<number>([...engine.cooldowns].filter((aura) => aura >= 0));
  const tags = new Set<AuraTagId>();

  for (const button of engine.buttons) {
    if (button !== undefined) {
      if (button.costAura >= 0) {
        auras.add(button.costAura);
      }

      for (const apply of button.applies) {
        auras.add(apply.aura);
      }

      for (const tag of [...button.requires, ...button.blockedBy, ...button.resets]) {
        tags.add(tag);
      }
    }
  }

  return Object.freeze({
    auras: [...auras].toSorted((a, b) => a - b).map((aura) => toId<'auras'>(aura)),
    tags: [...tags].toSorted((a, b) => a - b),
  });
};

/**
 * Builds an ability system (§I.6 Abilities) over a spell system, an aura system and the game's slots, compiling every
 * `button` spell's activation against the aura and stat tables (checked at load).
 */
export const createAbilitySystem = <G extends AbilityTypes>(options: AbilitySystemOptions<G>): AbilitySystem<G> => {
  const engine = new AbilityEngine<G>(options);
  const { slots, auras } = engine;

  return {
    slots,
    procKinds: createAbilityProcKinds(engine),
    mirrorReads: mirrorReadsOf(engine),
    createLoadout: () => new LoadoutRecord(slots.size),

    equip: (bearer, slot, ability) => {
      const isPlain = ability === undefined || typeof ability === 'number';

      equipIn(engine, bearer, [slot, isPlain ? ability : ability.spell, isPlain ? 1 : (ability.rank ?? 1)]);
    },

    abilityOf: (bearer, slot) => {
      checkSlot(slots, slot);

      return spellAt(loadoutOf(bearer), slot);
    },

    slotOf: (bearer, spell) => slotHolding(bearer, spell),

    bit: (slot) => {
      checkSlot(slots, slot);

      return 1 << slot;
    },

    canActivate: (bearer, slot) => {
      checkSlot(slots, slot);

      return canFire(engine, bearer, slot);
    },

    cooldownLeft: (bearer, slot) => {
      checkSlot(slots, slot);

      const aura = engine.cooldowns[slot] ?? -1;

      return aura < 0 ? 0 : auras.remaining(bearer, toId<'auras'>(aura));
    },

    tryActivate: (bearer, pressed, input) => {
      engine.input = input;

      return press(engine, bearer, pressed);
    },

    trigger: (bearer, spell, input) => triggerButton(engine, bearer, [spell, input]),

    travel: (bearer, dt) => {
      travel(engine, bearer, dt);
    },

    cooldownOf: (caster, spell, rank = 1) => cooldownSeconds(engine, caster, [spell, rank]),
    explain: (spell, rank = 1, caster) => explainButton(engine, [spell, rank], caster),
  };
};
