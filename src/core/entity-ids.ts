/**
 * One entity id space for a whole game: units, area triggers and anything else that crosses the wire under an id
 * draw from it (`units` and `areaTriggers` take its `next` as their `allocateId`), so a cue's or a replica's id never
 * means two things. Ids count from 1, whole numbers below 2³², never reused within a run.
 */
export interface EntityIds {
  /** The next id. */
  readonly next: () => number;

  /** The ids handed out so far: the next is one more, for a save to carry and `from` to go on from. */
  readonly count: () => number;
}

/** Makes an entity id space, going on from `from` ids already handed out (0 for a new run). */
export const createEntityIds = (from = 0): EntityIds => {
  if (!(Number.isInteger(from) && from >= 0)) {
    throw new RangeError(`Entity ids go on from a whole number of ids handed out; got ${from}.`);
  }

  let last = from;

  return Object.freeze({
    next: (): number => {
      if (last >= 2 ** 32 - 1) {
        throw new RangeError('The entity id space is spent.');
      }

      last += 1;

      return last;
    },

    count: (): number => last,
  });
};
