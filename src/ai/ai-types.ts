import type { Id } from '../core/index.ts';
import type { SpellCaster, SpellTypes } from '../spells/index.ts';
import type { BrainState } from './brain.ts';

/** The id of a timer: its position in the game's timer table (`defineTimers`). */
export type TimerId = Id<'timers'>;

/**
 * A unit with a brain: a caster that also holds a brain state (`ai.createBrain()`), where the AI system keeps its
 * timers and its focus, so every per-unit read is a field read.
 */
export interface AiBearer extends SpellCaster {
  /** The unit's brain, made by the AI system; the game reads and changes it through the system. */
  readonly brain: BrainState;
}

/** The types one game's AI is written against: the spell types, a bearer with a brain, and the names of its timers. */
export interface AiTypes extends SpellTypes {
  /** What thinks and casts. */
  readonly bearer: AiBearer;

  /** The names of the game's timers (`execute`, `raise`, `pick`). */
  readonly timerName: string;
}
