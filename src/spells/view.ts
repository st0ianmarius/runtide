import { stepsUntil } from '../core/index.ts';
import type { SpellEngine } from './engine.ts';
import type { CastHandle } from './ids.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/** The stages a cast view names by index: `windup` 0, `channel` 1, `recover` 2. */
export const CAST_STAGES = ['windup', 'channel', 'recover'] as const;

/**
 * A running cast as the wire carries it: ids and numbers only, so a client draws a cast bar and
 * plays a cast's cues without being sent its state. Its stage's end is a stamp on the spell clock, so the view does
 * not change while the stage counts down. `spells.viewOf` fills the caller's record: read it at once.
 */
export interface CastView {
  /** The spell. */
  spell: SpellId;

  /** Its rank. */
  rank: number;

  /** Its stage, by index in `CAST_STAGES`. */
  stage: number;

  /** The stage's length, in seconds. */
  seconds: number;

  /** The tick of the spell clock its stage ends on, counted by `stepsUntil`; `Infinity` while paused. */
  end: number;

  /** The tick it started on. */
  started: number;

  /** Its caster's entity id. */
  caster: number;

  /** The entity id its hits are credited to. */
  source: number;

  /** The key of the press that started it (a client matches its predicted cast bar and cues by it); 0 for none. */
  key: number;
}

/** Fills a cast's view into `out`; false, leaving it alone, for a stale or ended cast. */
export const viewCast = <G extends SpellTypes>(engine: SpellEngine<G>, handle: CastHandle, out: CastView): boolean => {
  const cast = engine.castOf(handle);

  if (cast === undefined || cast.stage === 'ended') {
    return false;
  }

  const { clock } = engine;

  out.spell = cast.spell;
  out.rank = cast.rank;
  out.stage = CAST_STAGES.indexOf(cast.stage);
  out.seconds = cast.stageSeconds;
  out.end = cast.isPaused ? Infinity : clock.tick + stepsUntil(cast.remaining, clock.dt);
  out.started = cast.startTick;
  out.caster = cast.casterId;
  out.source = cast.source;
  out.key = cast.cueKey;

  return true;
};
