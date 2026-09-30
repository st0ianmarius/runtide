import { stepsUntil } from '../core/index.ts';
import type { SpellEngine } from './engine.ts';
import type { CastHandle } from './ids.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/** The stages a cast view names by index: `windup` 0, `channel` 1, `recover` 2. */
export const CAST_STAGES = ['windup', 'channel', 'recover'] as const;

/**
 * A running cast as the wire carries it: ids and numbers only, so a client draws a cast bar and
 * plays a cast's cues without being sent its state. Its stage's end is a stamp on the spell clock, so the view does
 * not change while the stage counts down.
 */
export interface CastView {
  /** The spell. */
  readonly spell: SpellId;

  /** Its rank. */
  readonly rank: number;

  /** Its stage, by index in `CAST_STAGES`. */
  readonly stage: number;

  /** The stage's length, in seconds. */
  readonly seconds: number;

  /** The tick of the spell clock its stage ends on, counted by `stepsUntil`; `Infinity` while paused. */
  readonly end: number;

  /** The tick it started on. */
  readonly started: number;

  /** Its caster's entity id. */
  readonly caster: number;

  /** The entity id its hits are credited to. */
  readonly source: number;
}

/** A cast's view, or `undefined` for a stale or ended cast. */
export const viewCast = <G extends SpellTypes>(engine: SpellEngine<G>, handle: CastHandle): CastView | undefined => {
  const cast = engine.castOf(handle);

  if (cast === undefined || cast.stage === 'ended') {
    return undefined;
  }

  const { clock } = engine;

  return {
    spell: cast.spell,
    rank: cast.rank,
    stage: CAST_STAGES.indexOf(cast.stage),
    seconds: cast.stageSeconds,
    end: cast.isPaused ? Infinity : clock.tick + stepsUntil(cast.remaining, clock.dt),
    started: cast.startTick,
    caster: cast.casterId,
    source: cast.source,
  };
};
