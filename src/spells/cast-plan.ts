import type { ActivationKindDef, ActivationRegistry, CastSeconds, TimelineDefaults } from './activation.ts';
import type { AnySpellDef } from './spell-def.ts';
import type { ActivationShape, SpellTypes } from './spell-types.ts';
import { lockBefore, type Track } from './timeline.ts';

/** A track over any cast. */
type AnyTrack<G extends SpellTypes> = Track<G, NonNullable<AnySpellDef<G>['stats']>, unknown, unknown>;

/**
 * A spell's timeline with its activation kind's defaults filled in, resolved once at load: the seconds of each stage
 * (`undefined` for a stage it does not have) and how its windup tracks.
 */
export interface CastPlan<G extends SpellTypes> {
  /** The windup's seconds, or `undefined` for none. */
  readonly windup: CastSeconds<G> | undefined;

  /** How the windup's aim tracks, or `undefined` to lock at the start. */
  readonly track: AnyTrack<G> | undefined;

  /** The channel's seconds, or `undefined` for none. */
  readonly channel: CastSeconds<G> | undefined;

  /** The seconds between channel beats; 0 beats every step. */
  readonly every: number;

  /** The recovery's seconds, or `undefined` for none. */
  readonly recover: CastSeconds<G> | undefined;
}

/** The timeline defaults a spell's activation kind supplies. */
const defaultsOf = <G extends SpellTypes>(
  def: AnySpellDef<G>,
  activations: ActivationRegistry<G>,
): TimelineDefaults => {
  const ids: Readonly<Record<string, number | undefined>> = activations.id;
  const kindId = ids[def.activation.kind];

  const kind: ActivationKindDef<ActivationShape, G> | undefined =
    kindId === undefined ? undefined : activations.defs[kindId];

  return kind?.timeline?.(def.activation) ?? {};
};

/** The track a spell's windup uses: its own, or the activation's `lockBefore` when the spell picks a target. */
const trackOf = <G extends SpellTypes>(def: AnySpellDef<G>, defaults: TimelineDefaults): AnyTrack<G> | undefined => {
  const own = def.timeline?.windup?.track;

  if (own !== undefined) {
    return own;
  }

  return defaults.lockBefore === undefined || def.target === undefined ? undefined : lockBefore(defaults.lockBefore);
};

/** Resolves a spell's plan: its timeline's stages, else its activation kind's defaults. */
export const planOf = <G extends SpellTypes>(def: AnySpellDef<G>, activations: ActivationRegistry<G>): CastPlan<G> => {
  const defaults = defaultsOf(def, activations);
  const { timeline } = def;

  return Object.freeze({
    windup: timeline?.windup?.seconds ?? defaults.windup,
    track: trackOf(def, defaults),
    channel: timeline?.channel?.seconds,
    every: timeline?.channel?.every ?? 0,
    recover: timeline?.recover?.seconds ?? defaults.recover,
  });
};

/** A stage's seconds as a column entry: its constant, NaN when read per cast, 0 for a stage it does not have. */
export const constantOf = <G extends SpellTypes>(seconds: CastSeconds<G> | undefined): number => {
  if (seconds === undefined) {
    return 0;
  }

  return typeof seconds === 'number' ? seconds : Number.NaN;
};
