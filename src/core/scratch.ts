/**
 * Reusable scratch storage, one array per nesting level: a caller takes the array for its level, fills it
 * by index while counting how many entries it wrote, reads those entries, and gives it back, so a nested caller (a
 * trigger that raises an event that runs triggers) gets its own array. An array keeps its storage between uses (it is
 * never shrunk, since shrinking an array to 0 drops its backing store and the next fill allocates it again), so
 * nothing is allocated once every level has been reached at its largest size.
 *
 * A caller that can throw between `take` and `give` (anything that calls a hook or raises an event) gives back in a
 * `finally`: a missed `give` leaves the stack one level deeper for good, so every later caller takes the wrong array
 * and the depth never returns to 0.
 */
export interface Scratch<Item> {
  /** How many arrays are taken right now. */
  readonly depth: number;

  /**
   * Takes the array of the next level. It holds whatever its last user left past index 0, so the caller writes by
   * index and reads only what it wrote. Pair it with a `give` in a `finally` whenever the work in between can throw.
   */
  readonly take: () => (Item | undefined)[];

  /**
   * Gives the most recently taken array back, clearing its first `used` entries (0 by default) so it keeps no
   * references to them.
   */
  readonly give: (used?: number) => void;
}

/** A scratch stack's state: a class for fast properties, its functions arrow fields so they work detached. */
class ScratchStack<Item> implements Scratch<Item> {
  readonly #levels: (Item | undefined)[][] = [];
  #depth = 0;

  get depth(): number {
    return this.#depth;
  }

  readonly take = (): (Item | undefined)[] => {
    const list = this.#levels[this.#depth] ?? [];

    this.#levels[this.#depth] = list;
    this.#depth += 1;

    return list;
  };

  readonly give = (used = 0): void => {
    if (this.#depth === 0) {
      throw new RangeError('No scratch array is taken.');
    }

    this.#depth -= 1;

    const list = this.#levels[this.#depth] ?? [];

    for (let i = 0; i < used; i++) {
      list[i] = undefined;
    }
  };
}

/** Creates an empty stack of scratch arrays. */
export const createScratch = <Item>(): Scratch<Item> => new ScratchStack<Item>();
