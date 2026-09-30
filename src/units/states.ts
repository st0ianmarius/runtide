import type { AuraTagTable } from '../auras/index.ts';
import { type Bitset, createBitset } from '../core/index.ts';

/** What a derived state keeps a unit from doing, or from having done to it: being picked as a target (`target`). */
export type UnitBlock = 'act' | 'move' | 'target';

/** A derived unit state: held while the unit holds an aura with any of its aura tags. */
export interface UnitStateDef<T extends string = string, I extends string = string> {
  /** The aura tags that put a unit in it. */
  readonly tags: readonly T[];

  /**
   * What it keeps the unit from doing: casting and acting (`act`), moving (`move`), being picked as a target
   * (`target`: stealth, phasing, a spawn intro); nothing when absent.
   */
  readonly blocks?: readonly UnitBlock[];

  /**
   * The interrupt it raises on the unit's casts and brain while the unit is in it (a stun's `stun`), through
   * `units.syncStates`, which the aura host's `onTagsChanged` calls; none when absent.
   */
  readonly interrupt?: I;
}

/** A state that raises an interrupt: its aura tags and the interrupt. */
export interface InterruptingState<I extends string = string> {
  /** Its aura tags. */
  readonly tags: Bitset;

  /** The interrupt it raises. */
  readonly reason: I;
}

/** The most states that may raise interrupts: each is a bit of a unit's `interrupts`. */
const MAX_INTERRUPTING = 31;

/** The game's derived states, compiled: each state's aura tag bitset and blocks, and the tags that block each. */
export interface UnitStateTable<Name extends string = string, I extends string = string> {
  /** The state names, in declared order. */
  readonly names: readonly Name[];

  /** Each state's aura tags, as a bitset over aura tag ids. */
  readonly tags: Readonly<Record<Name, Bitset>>;

  /** The aura tags that keep a unit from acting. */
  readonly blocksAct: Bitset;

  /** The aura tags that keep a unit from moving. */
  readonly blocksMove: Bitset;

  /** The aura tags that keep a unit from being picked as a target. */
  readonly blocksTarget: Bitset;

  /** The states that raise interrupts, in declared order: a unit keeps one bit each. */
  readonly interrupting: readonly InterruptingState<I>[];
}

/**
 * Declares the game's derived unit states over its aura tags: `defineUnitStates(AURA_TAGS, { stunned: {
 * tags: ['stun'], blocks: ['act', 'move'], interrupt: 'stun' }, rooted: { tags: ['root'], blocks: ['move'] },
 * invulnerable: { tags: ['invuln'] } })`. A state is never stored: it is read from the unit's aura tags, so an aura
 * landing or leaving is all it takes. Throws for an aura tag the table does not have, or past 31 interrupting states.
 */
export const defineUnitStates = <T extends string, const Name extends string, const I extends string = never>(
  auraTags: AuraTagTable<T>,
  states: Readonly<Record<Name, UnitStateDef<NoInfer<T>, I>>>
): UnitStateTable<Name, I> => {
  const names = Object.keys(states).filter((key): key is Name => Object.hasOwn(states, key));
  const ids: Readonly<Record<string, number | undefined>> = auraTags.id;

  const bitsOf = (name: Name, tags: readonly string[]): Bitset =>
    createBitset(
      tags.map((tag) => {
        const id = ids[tag];

        if (id === undefined) {
          throw new RangeError(`Unit state ${name}: there is no aura tag named ${tag}.`);
        }

        return id;
      })
    );

  const tags: Readonly<Record<string, Bitset | undefined>> = Object.fromEntries(
    names.map((name) => [name, bitsOf(name, states[name].tags)])
  );

  const blocking = (block: UnitBlock): Bitset => {
    const set = createBitset();

    for (const name of names) {
      const bits = tags[name];

      if (bits !== undefined && (states[name].blocks ?? []).includes(block)) {
        set.union(bits);
      }
    }

    return set;
  };

  if (!isRecordOf<Name>(tags, names)) {
    throw new Error('A unit state table lost a state while it was built.');
  }

  const interrupting = names.flatMap((name): InterruptingState<I>[] => {
    const reason = states[name].interrupt;

    return reason === undefined ? [] : [{ tags: tags[name], reason }];
  });

  if (interrupting.length > MAX_INTERRUPTING) {
    throw new RangeError(`At most ${MAX_INTERRUPTING} unit states may raise interrupts; got ${interrupting.length}.`);
  }

  return Object.freeze({
    names: Object.freeze(names),
    tags: Object.freeze(tags),
    blocksAct: blocking('act'),
    blocksMove: blocking('move'),
    blocksTarget: blocking('target'),
    interrupting: Object.freeze(interrupting)
  });
};

/** Whether a record has a bitset for every name. */
const isRecordOf = <Name extends string>(
  record: Readonly<Record<string, Bitset | undefined>>,
  names: readonly Name[]
): record is Readonly<Record<Name, Bitset>> => names.every((name) => record[name] !== undefined);
