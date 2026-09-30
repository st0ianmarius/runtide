import { createRegistry, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** An area trigger tag's definition: a tag is a name and an id, nothing more. */
export type AreaTagDef = Readonly<Record<never, never>>;

/** The game's area trigger tags: dense ids, so an area trigger kind's tags are a bitset (§I.5.4). */
export type AreaTagTable<Name extends string = string> = Registry<'areaTags', Extract<Name, string>, AreaTagDef, never>;

/**
 * Declares the game's area trigger tags (`defineAreaTags(['dome', 'pool'])`): what `coveredBy`, the area trigger
 * queries and the game's own rules read about a kind. Append-only, like any registry.
 */
export const defineAreaTags = <const Name extends string>(names: readonly Name[]): AreaTagTable<Name> =>
  createRegistry(
    recordOf(names, (): AreaTagDef => ({})),
    { kind: 'areaTags' },
  );
