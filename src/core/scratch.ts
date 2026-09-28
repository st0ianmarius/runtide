/**
 * Reusable scratch lists, one per nesting level (§I.5.4): a caller takes the list for its level, fills it, reads it,
 * and gives it back, so a nested caller (a trigger that raises an event that runs triggers) gets its own list and
 * nothing is allocated once every level has been reached once.
 */
export interface Scratch<Item> {
  /** How many lists are taken right now. */
  readonly depth: number;

  /** Takes the list of the next level, emptied. */
  readonly take: () => Item[];

  /** Gives the most recently taken list back and empties it, so it holds no references. */
  readonly give: () => void;
}

/** Creates an empty stack of scratch lists. */
export const createScratch = <Item>(): Scratch<Item> => {
  const levels: Item[][] = [];
  let depth = 0;

  return {
    get depth() {
      return depth;
    },

    take: () => {
      const list = levels[depth] ?? [];

      levels[depth] = list;
      depth += 1;
      list.length = 0;

      return list;
    },

    give: () => {
      if (depth === 0) {
        throw new RangeError('No scratch list is taken.');
      }

      depth -= 1;

      const list = levels[depth];

      if (list !== undefined) {
        list.length = 0;
      }
    },
  };
};
