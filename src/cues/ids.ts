/**
 * The cue registry's branded ids: plain numbers at runtime. This file is one of the few that may cast,
 * because a brand can only be put on a number by an assertion.
 */
import type { Id } from '../core/index.ts';

declare const cueNameBrand: unique symbol;

declare const paramBrand: unique symbol;

/** The id of a cue: its position in the game's cue registry (`defineCues`), and what crosses the wire. */
export type CueId = Id<'cues'>;

/**
 * The id of one named cue: a `CueId` that also carries the cue's name in the type system, so a spec written with
 * `CUES.id.impact` gets the impact cue's params checked, at no runtime cost.
 */
export type CueIdOf<Name extends string> = CueId & {
  /** The cue's name; it exists only in the type system. */
  readonly [cueNameBrand]: Name;
};

/**
 * One param of one cue, resolved at load (`CUES.params.impact.amount`): the index of its first slot in a cue event's
 * `values`, so a hot path reads and writes it with no lookup.
 */
export type CueParam = number & {
  /** Marks the number as a cue param's slot; it exists only in the type system. */
  readonly [paramBrand]: 'cueParam';
};

/** Brands a number read from the wire as a cue id; the decoder checks it against the registry before using it. */
export const toCueId = (index: number): CueId => index as CueId;

/** Brands a slot index as a cue param. Only the cue registry calls it. */
export const toCueParam = (slot: number): CueParam => slot as CueParam;

/** Re-types a registry's ids as ids that carry their names. Only the cue registry calls it. */
export const namedCueIds = <Name extends string>(
  ids: Readonly<Record<Name, CueId>>
): { readonly [Key in Name]: CueIdOf<Key> } => ids as { readonly [Key in Name]: CueIdOf<Key> };
