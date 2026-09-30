import type { CastSeconds } from './activation.ts';
import { reachOf, type ReachPlan } from './reach.ts';
import type { AnySpellDef } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';
import type { Track } from './timeline.ts';

/** A track over any cast. */
type AnyTrack<G extends SpellTypes> = Track<G, NonNullable<AnySpellDef<G>['stats']>, unknown, unknown>;

/**
 * A spell's timeline, resolved once at load: the seconds of each stage
 * (`undefined` for a stage it does not have) and how its windup tracks.
 */
export interface CastPlan<G extends SpellTypes> {
  /** The windup's seconds, or `undefined` for none. */
  readonly windup: CastSeconds<G> | undefined;

  /** How the windup's aim tracks, or `undefined` to lock at the start. */
  readonly track: AnyTrack<G> | undefined;

  /** The channel's seconds, or `undefined` for none. */
  readonly channel: CastSeconds<G> | undefined;

  /** The seconds between channel beats, or `undefined` to beat every step. */
  readonly every: CastSeconds<G> | undefined;

  /** The recovery's seconds, or `undefined` for none. */
  readonly recover: CastSeconds<G> | undefined;

  /** Its reach rules, or `undefined` for none. */
  readonly reach: ReachPlan<G> | undefined;
}

/** Resolves a spell's plan: its timeline's stages and its reach. */
export const planOf = <G extends SpellTypes>(def: AnySpellDef<G>, name: string): CastPlan<G> => {
  const { timeline } = def;

  return Object.freeze({
    windup: timeline?.windup?.seconds,
    track: timeline?.windup?.track,
    channel: timeline?.channel?.seconds,
    every: timeline?.channel?.every,
    recover: timeline?.recover?.seconds,
    reach: reachOf(def, name)
  });
};

/** A stage's seconds as a column entry: its constant, NaN when read per cast, 0 for a stage it does not have. */
export const constantOf = <G extends SpellTypes>(seconds: CastSeconds<G> | undefined): number => {
  if (seconds === undefined) {
    return 0;
  }

  return typeof seconds === 'number' ? seconds : Number.NaN;
};
