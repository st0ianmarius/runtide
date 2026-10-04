/**
 * What the AI system keeps on a unit (`AiBearer.brain`): its timers and its focus. The game reads the focus here,
 * and changes it through the system; where a unit wants to go is the game's own.
 */
export interface BrainState {
  /** The entity id of the unit it focuses (a tether's target, a sticky target); −1 for none. */
  readonly focus: number;
}

/** A brain's record: a class for fast properties, its timer columns typed arrays. */
export class Brain implements BrainState {
  /** Its index among the system's brains; −1 for the shared brain of a unit with none. */
  readonly slot: number;

  /** The tick each timer is due on; NaN for a timer not running or held. */
  readonly due: Float64Array;

  /** The seconds each timer had left when its brain was held; NaN for none. */
  readonly left: Float64Array;

  /** How many times each timer was put on the wheel, wrapped: what tells its live entry from a stale one. */
  readonly starts: Uint32Array;

  /**
   * When each timer was last started, or collected (`ai.collect`), on the system's count: a held brain's timers go back
   * on the wheel in this order, so timers due on one tick still fire in the order they were started.
   */
  readonly stamps: Float64Array;

  /** The bits of the reasons holding its timers (`ai.hold`); 0 when they count. */
  holds = 0;

  /** A bit per timer collected and not yet taken (`ai.collect`, `ai.take`). */
  collected = 0;

  focus = -1;

  constructor(slot: number, timers: number) {
    this.slot = slot;
    this.due = new Float64Array(timers).fill(Number.NaN);
    this.left = new Float64Array(timers).fill(Number.NaN);
    this.starts = new Uint32Array(timers);
    this.stamps = new Float64Array(timers);
  }
}

/** The brain of a unit that does not think (a hero, a wall): no timers, shared, never written. */
export const NO_BRAIN: BrainState = Object.freeze(new Brain(-1, 0));

/** A unit's brain record, or a clear error for a brain the system did not make. */
export const brainOf = (state: BrainState): Brain => {
  if (!(state instanceof Brain) || state.slot < 0) {
    throw new TypeError('A thinking unit needs a brain made by ai.createBrain().');
  }

  return state;
};
