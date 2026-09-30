/**
 * What the AI system keeps on a unit (`AiBearer.brain`): its timers, its focus and its last pick. The game reads the
 * focus and the last pick here, and changes them through the system; where a unit wants to go is the game's own.
 */
export interface BrainState {
  /** The entity id of the unit it focuses (a tether's target, a sticky target); −1 for none. */
  readonly focus: number;

  /** The spell it last picked (`ai.pick`); −1 before its first. */
  readonly lastPick: number;
}

/** A brain's record: a class for fast properties, its timer columns typed arrays (§I.5.4). */
export class Brain implements BrainState {
  /** Its index among the system's brains; −1 for the shared brain of a unit with none. */
  readonly slot: number;

  /** The tick each timer is due on; NaN for a timer not running or held. */
  readonly due: Float64Array;

  /** The seconds each timer had left when its brain was held; NaN for none. */
  readonly left: Float64Array;

  /** Each timer's generation, raised whenever its entry on the wheel goes stale. */
  readonly generations: Uint32Array;

  /** The bits of the reasons holding its timers (`ai.hold`); 0 when they count. */
  holds = 0;

  focus = -1;
  lastPick = -1;

  constructor(slot: number, timers: number) {
    this.slot = slot;
    this.due = new Float64Array(timers).fill(Number.NaN);
    this.left = new Float64Array(timers).fill(Number.NaN);
    this.generations = new Uint32Array(timers);
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
