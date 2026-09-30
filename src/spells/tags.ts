import { createRegistry, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** A spell tag's definition: a tag is a name and an id, nothing more. */
export type SpellTagDef = Readonly<Record<never, never>>;

/** The game's spell tags: dense ids, so a spell's tags are a bitset. */
export type SpellTagTable<Name extends string = string> = Registry<
  'spellTags',
  Extract<Name, string>,
  SpellTagDef,
  never
>;

/**
 * Declares the game's spell tags (`defineSpellTags(['area', 'fire', 'creature'])`): what modifier scopes, trigger
 * filters and the game's own rules read about a spell. Append-only, like any registry.
 */
export const defineSpellTags = <const Name extends string>(names: readonly Name[]): SpellTagTable<Name> =>
  createRegistry(
    recordOf(names, (): SpellTagDef => ({})),
    { kind: 'spellTags' },
  );
