import type { AuraId, AuraTagId } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityTypes, ButtonRefusal, PressRefusal, SlotId } from './ability-types.ts';
import { AbilityEngine, type AbilityParts } from './engine.ts';
import { type ButtonExplanation, explainButton } from './explain.ts';
import { press, refusalAt, slotHolding, spellAt } from './firing.ts';
import { loadoutOf, LoadoutRecord, type LoadoutState } from './loadout.ts';
import type { SlotTable } from './slots.ts';

/** One press's data: what its casts are handed, and the key their predicted cast cues carry. */
export interface Press<G extends AbilityTypes> {
  /** What its casts and `activate` hooks are handed: an aim, a direction. */
  readonly input?: G['input'] | undefined;

  /**
   * The press's key (the game's input sequence), the same on the server and the predicting client, which each fired
   * spell's cast cue carries; 0 when absent.
   */
  readonly key?: number | undefined;

  /**
   * Where each pressed slot's refusal is written, by slot: why it did not fire (its rules, its `checkCast`, the cast
   * order for a button that commits on its cast), or why its committed cast was refused all the same; `undefined` for a
   * slot that fired cleanly or was not pressed. None is written when absent.
   */
  readonly refusals?: (PressRefusal<G> | undefined)[] | undefined;
}

/** A button spell equipped at a rank. */
export interface Equipped {
  /** The button spell. */
  readonly spell: SpellId;

  /** Its rank, from 1 to the spell's ranks; 1 when absent. */
  readonly rank?: number;
}

/** What a press reads on its bearer: the auras and tags a prediction mirror must rebuild. */
export interface MirrorReads {
  /** Every button spell's cooldown auras and every button's cost aura, in id order. */
  readonly auras: readonly AuraId[];

  /** Every tag a button's `requires`, `blockedBy` or `resets` names, in id order. */
  readonly tags: readonly AuraTagId[];
}

/** What an ability system is built from: the spell and aura systems, the game's slots, the caster's stats. */
export type AbilitySystemOptions<G extends AbilityTypes> = AbilityParts<G>;

/**
 * An ability system: buttons over a spell system. A unit's loadout puts a `button` spell in each slot;
 * a press fires the pressed slots whose ability may fire, each paying its cost, running its motion half, starting its
 * spell's cooldowns, landing its auras, then casting its spell: all at the press, or once its cast is admitted.
 */
export interface AbilitySystem<G extends AbilityTypes> {
  /** The game's slots. */
  readonly slots: SlotTable<G['slot']>;

  /**
   * The auras and tags a press reads on its bearer (its spells' cooldowns, its costs, the tags of `requires`,
   * `blockedBy` and `resets`): what a prediction mirror must rebuild, so each such aura is `predicted`
   * (`checkPredicted`). The auras a press lands are not reads: one that matters is read through a tag or through the
   * game's motion reads.
   */
  readonly mirrorReads: MirrorReads;

  /** A new, empty loadout, for a unit with buttons (`AbilityBearer.loadout`). */
  readonly createLoadout: () => LoadoutState;

  /**
   * Puts a button spell in a slot (at rank 1, or at the rank given with it), or empties the slot (`undefined`).
   * Throws for a spell that is not a live button spell, or a rank outside the spell's.
   */
  readonly equip: (bearer: G['bearer'], slot: SlotId, ability: SpellId | Equipped | undefined) => void;

  /** The spell in a slot; `undefined` for an empty one. */
  readonly abilityOf: (bearer: G['bearer'], slot: SlotId) => SpellId | undefined;

  /** The first slot holding a spell; `undefined` when it is not in the loadout (an area trigger's bound). */
  readonly slotOf: (bearer: G['bearer'], spell: SpellId) => SlotId | undefined;

  /** The press mask bit of a slot: a game builds a press from its input as `bit(dodge) | bit(skill)`. */
  readonly bit: (slot: SlotId) => number;

  /**
   * Whether the ability in a slot may fire now, by its own rules: `undefined` when it may, else why not: the slot holds
   * none (`empty`), one of its spell's cooldowns is on the bearer (`cooldown`), a `requires` tag is missing
   * (`requires`), a `blockedBy` tag is held (`blocked`), or the cost is not affordable (`cost`). Reads only the bearer.
   */
  readonly check: (bearer: G['bearer'], slot: SlotId) => ButtonRefusal | undefined;

  /** The seconds until the ability in a slot may fire again: the most left on its spell's cooldowns; 0 when ready. */
  readonly cooldownLeft: (bearer: G['bearer'], slot: SlotId) => number;

  /**
   * A press: every pressed slot (a mask of `bit`s) is decided against the bearer before any fires, then each accepted
   * one fires in slot order: asks `checkCast` (and, for a button that commits on its cast, the cast order), then
   * commits (pays its cost, runs `activate` with a `MirrorCtx` of the press, starts its spell's cooldowns, lands
   * `applies` then `resets`) and casts its spell with the press's input, rank and key (a no-windup spell releases here,
   * before the game moves the bearer). Returns the mask of the slots that committed, and writes the refusals into the
   * press's `refusals`. The game calls it inside its motion step, on the server and on a prediction mirror alike.
   */
  readonly tryActivate: (bearer: G['bearer'], pressed: number, press?: Press<G>) => number;

  /**
   * A button spell's rules as data, for the client's tooltip (its cooldowns are its spell's, in `explainSpell`).
   * `undefined` for a spell that is not a button.
   */
  readonly explain: (spell: SpellId) => ButtonExplanation | undefined;
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
  [slot, spell, rank]: readonly [SlotId, SpellId | undefined, number]
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

  record.spells[slot] = spell;
  record.ranks[slot] = rank;
};

/** The auras and tags an engine's presses read, sorted and without repeats. */
const mirrorReadsOf = <G extends AbilityTypes>(engine: AbilityEngine<G>): MirrorReads => {
  const auras = new Set<number>();
  const tags = new Set<AuraTagId>();

  for (const [spell, button] of engine.buttons.entries()) {
    if (button !== undefined) {
      for (const aura of engine.spells.cooldownsOf(toId<'spells'>(spell))) {
        auras.add(aura);
      }

      if (button.costAura >= 0) {
        auras.add(button.costAura);
      }

      if (button.toggle >= 0) {
        auras.add(button.toggle);
      }

      for (const tag of [...button.requires, ...button.blockedBy, ...button.resets]) {
        tags.add(tag);
      }
    }
  }

  return Object.freeze({
    auras: [...auras].toSorted((a, b) => a - b).map((aura) => toId<'auras'>(aura)),
    tags: [...tags].toSorted((a, b) => a - b)
  });
};

/**
 * Builds an ability system over a spell system, an aura system and the game's slots, compiling every
 * `button` spell's activation against the aura and stat tables (checked at load).
 */
export const createAbilitySystem = <G extends AbilityTypes>(options: AbilitySystemOptions<G>): AbilitySystem<G> => {
  const engine = new AbilityEngine<G>(options);
  const { slots } = engine;

  return {
    slots,
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

    check: (bearer, slot) => {
      checkSlot(slots, slot);

      return refusalAt(engine, bearer, slot);
    },

    cooldownLeft: (bearer, slot) => {
      checkSlot(slots, slot);

      const spell = spellAt(loadoutOf(bearer), slot);

      return spell === undefined ? 0 : engine.spells.cooldownLeft(bearer, spell);
    },

    tryActivate: (bearer, pressed, data) => {
      // A press from a hook of another (a pet ordered along) leaves the one it interrupted as it found it.
      engine.enter();

      try {
        engine.input = data?.input;
        engine.key = data?.key ?? 0;
        engine.refusals = data?.refusals;

        return press(engine, bearer, pressed);
      } finally {
        engine.leave();
      }
    },

    explain: (spell) => explainButton(engine, spell)
  };
};
