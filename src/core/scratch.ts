/**
 * Reusable scratch storage, one array per nesting level (§I.5.4): a caller takes the array for its level, fills it
 * by index while counting how many entries it wrote, reads those entries, and gives it back, so a nested caller (a
 * trigger that raises an event that runs triggers) gets its own array. An array keeps its storage between uses (it is
 * never shrunk, since shrinking an array to 0 drops its backing store and the next fill allocates it again), so
 * nothing is allocated once every level has been reached at its largest size.
 */
export interface Scratch<Item> {
  /** How many arrays are taken right now. */
  readonly depth: number;

  /**
   * Takes the array of the next level. It holds whatever its last user left past index 0, so the caller writes by
   * index and reads only what it wrote.
   */
  readonly take: () => (Item | undefined)[];

  /**
   * Gives the most recently taken array back, clearing its first `used` entries (0 by default) so it keeps no
   * references to them.
   */
  readonly give: (used?: number) => void;
}

/** Creates an empty stack of scratch arrays. */
export const createScratch = <Item>(): Scratch<Item> => {
  const levels: (Item | undefined)[][] = [];
  let depth = 0;

  return {
    get depth() {
      return depth;
    },

    take: () => {
      const list = levels[depth] ?? [];

      levels[depth] = list;
      depth += 1;

      return list;
    },

    give: (used = 0) => {
      if (depth === 0) {
        throw new RangeError('No scratch array is taken.');
      }

      depth -= 1;

      const list = levels[depth] ?? [];

      for (let i = 0; i < used; i++) {
        list[i] = undefined;
      }
    },
  };
};
