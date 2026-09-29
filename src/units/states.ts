import type { AuraTagTable } from '../auras/index.ts';
import { type Bitset, createBitset } from '../core/index.ts';

/** What a derived state keeps a unit from doing. */
export type UnitBlock = 'act' | 'move';

/** A derived unit state (§I.7.1 F13): held while the unit holds an aura with any of its aura tags. */
export interface UnitStateDef<T extends string = string> {
  /** The aura tags that put a unit in it. */
  readonly tags: readonly T[];

  /** What it keeps the unit from doing: casting and acting (`act`), moving (`move`); nothing when absent. */
  readonly blocks?: readonly UnitBlock[];
}

/** The game's derived states, compiled: each state's aura tag bitset and blocks, and the tags that block each. */
export interface UnitStateTable<Name extends string = string> {
  /** The state names, in declared order. */
  readonly names: readonly Name[];

  /** Each state's aura tags, as a bitset over aura tag ids. */
  readonly tags: Readonly<Record<Name, Bitset>>;

  /** The aura tags that keep a unit from acting. */
  readonly blocksAct: Bitset;

  /** The aura tags that keep a unit from moving. */
  readonly blocksMove: Bitset;
}

/**
 * Declares the game's derived unit states over its aura tags (§I.7.1 F13): `defineUnitStates(AURA_TAGS, { stunned: {
 * tags: ['stun'], blocks: ['act', 'move'] }, rooted: { tags: ['root'], blocks: ['move'] }, invulnerable: { tags:
 * ['invuln'] } })`. A state is never stored: it is read from the unit's aura tags, so an aura landing or leaving is
 * all it takes. Throws for an aura tag the table does not have.
 */
export const defineUnitStates = <T extends string, const Name extends string>(
  auraTags: AuraTagTable<T>,
  states: Readonly<Record<Name, UnitStateDef<NoInfer<T>>>>,
): UnitStateTable<Name> => {
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
      }),
    );

  const tags: Readonly<Record<string, Bitset | undefined>> = Object.fromEntries(
    names.map((name) => [name, bitsOf(name, states[name].tags)]),
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

  return Object.freeze({
    names: Object.freeze(names),
    tags: Object.freeze(tags),
    blocksAct: blocking('act'),
    blocksMove: blocking('move'),
  });
};

/** Whether a record has a bitset for every name. */
const isRecordOf = <Name extends string>(
  record: Readonly<Record<string, Bitset | undefined>>,
  names: readonly Name[],
): record is Readonly<Record<Name, Bitset>> => names.every((name) => record[name] !== undefined);
