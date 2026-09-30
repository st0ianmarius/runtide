import { createRegistry, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** An aura tag's definition: a tag is a name and an id, nothing more. */
export type AuraTagDef = Readonly<Record<never, never>>;

/** The game's aura tags: dense ids, so a bearer's tags, immunities and cleanses are bitsets. */
export type AuraTagTable<Name extends string = string> = Registry<'auraTags', Extract<Name, string>, AuraTagDef, never>;

/**
 * Declares the game's aura tags (`defineAuraTags(['stunned', 'rooted', 'magic'])`): what active auras say about their
 * bearer, which immunities (`blockedBy`), cleanses (`removes`) and conditions read. Append-only, like any registry.
 */
export const defineAuraTags = <const Name extends string>(names: readonly Name[]): AuraTagTable<Name> =>
  createRegistry(
    recordOf(names, (): AuraTagDef => ({})),
    { kind: 'auraTags' },
  );
