import { createRegistry, type Id, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** The id of a modifier source: its fold position, in the order the game declared its sources. */
export type SourceId = Id<'sources'>;

/** A modifier source's definition: a source is a name and a fold position, nothing more. */
export type SourceDef = Readonly<Record<never, never>>;

/** The game's modifier sources, in fold order. */
export type SourceTable<Name extends string = string> = Registry<'sources', Extract<Name, string>, SourceDef, never>;

/** The most sources a game can declare: a fold's source filter is one 32-bit mask. */
const MAX_SOURCES = 32;

/**
 * Declares the game's modifier sources in fold order: `defineSources(['race', 'gear', 'talents', 'auras',
 * 'stance'])`. Additions sum and multipliers apply one by one in this order, so it is part of every stat's float
 * result; an aura names the source it folds at (`'auras'`, or any other the game declared).
 */
export const defineSources = <const Name extends string>(names: readonly Name[]): SourceTable<Name> => {
  if (names.length > MAX_SOURCES) {
    throw new RangeError(`A game declares at most ${MAX_SOURCES} modifier sources; it declared ${names.length}.`);
  }

  return createRegistry(
    recordOf(names, (): SourceDef => ({})),
    { kind: 'sources' },
  );
};

/**
 * The mask of the named sources, for a partial fold: `sourceMask(SOURCES, ['race', 'gear'])` folds those
 * two only, for a value that must leave the others out (a base speed shown before any aura). Build it once, at load.
 */
export const sourceMask = <Name extends string>(
  sources: SourceTable<Name>,
  names: readonly Extract<Name, string>[],
): number => {
  let mask = 0;

  for (const name of names) {
    mask |= 1 << sources.id[name];
  }

  return mask;
};
