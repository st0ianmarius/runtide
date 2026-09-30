import { createRegistry, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** A unit class tag's definition: a tag is a name and an id, nothing more. */
export type UnitTagDef = Readonly<Record<never, never>>;

/** The game's unit class tags: dense ids, so a unit's classes are a bitset. */
export type UnitTagTable<Name extends string = string> = Registry<'unitTags', Extract<Name, string>, UnitTagDef, never>;

/**
 * Declares the game's unit class tags: `defineUnitTags(['horde', 'elite', 'boss', 'objective'])`, which
 * templates carry and conditions and the game's hooks read. Append-only, like any registry.
 */
export const defineUnitTags = <const Name extends string>(names: readonly Name[]): UnitTagTable<Name> =>
  createRegistry(
    recordOf(names, (): UnitTagDef => ({})),
    { kind: 'unitTags' },
  );
