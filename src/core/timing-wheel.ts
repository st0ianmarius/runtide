import FlatQueue from 'flatqueue';

import type { Defined } from './defined.ts';

/** What a timing wheel is created with. */
export interface TimingWheelOptions {
  /** The number of ticks the wheel holds in buckets, rounded up to a power of two; 256 by default. */
  readonly horizon?: number;

  /** The first tick the wheel collects; 0 by default. */
  readonly start?: number;
}

/**
 * A timing wheel over a fixed-step clock: one FIFO bucket per tick over a fixed horizon, so scheduling and
 * firing are O(1), and items due on the same tick come out in the order they were scheduled. Items beyond the horizon
 * wait in a heap and move into the wheel, in scheduling order, as their tick comes into range.
 */
export interface TimingWheel<Item extends Defined> {
  /** The next tick `collect` has not reached yet. */
  readonly cursor: number;

  /** The number of items scheduled and not collected yet. */
  readonly size: number;

  /**
   * Schedules `item` for tick `at`. A tick the wheel already collected is late, and fires at the next `collect`, after
   * the items already due then.
   */
  readonly schedule: (at: number, item: Item) => void;

  /**
   * Writes every item due up to and including tick `through` into `out` from index 0, tick by tick, each tick's items
   * in scheduling order, moves the cursor past `through`, and returns how many it wrote. `out` keeps its storage (it
   * is never shrunk, so a reused array allocates nothing); entries past the count that a previous call wrote are
   * cleared to `undefined`, so it keeps no references.
   */
  readonly collect: (through: number, out: (Item | undefined)[]) => number;
}

/** The smallest power of two at or above `n`, and at least 1. */
const powerOfTwo = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Clears the entries of `out` from `from` up to the first one already clear. */
const clearFrom = (out: unknown[], from: number): void => {
  for (let i = from; i < out.length && out[i] !== undefined; i++) {
    out[i] = undefined;
  }
};

/**
 * One tick's items: filled by index up to its count and never shrunk, since shrinking an array to 0 drops its
 * backing store and the next tick that lands here would allocate it again.
 */
interface Bucket<Item> {
  /** The items, valid up to `count`. */
  readonly items: (Item | undefined)[];

  /** How many items the bucket holds. */
  count: number;
}

/** A timing wheel's state: a class for fast properties, its functions arrow fields so they work detached. */
class Wheel<Item extends Defined> implements TimingWheel<Item> {
  readonly #horizon: number;
  readonly #buckets: Bucket<Item>[];
  readonly #overflow = createOverflow<Item>();
  #cursor: number;
  #size = 0;

  constructor(options: TimingWheelOptions) {
    this.#horizon = powerOfTwo(options.horizon ?? 256);
    this.#buckets = Array.from({ length: this.#horizon }, () => ({ items: [], count: 0 }));
    this.#cursor = options.start ?? 0;
  }

  get cursor(): number {
    return this.#cursor;
  }

  get size(): number {
    return this.#size;
  }

  readonly schedule = (at: number, item: Item): void => {
    if (!Number.isFinite(at)) {
      throw new RangeError(`A timer needs a finite tick; got ${at}.`);
    }

    const tick = Math.max(Math.trunc(at), this.#cursor);

    this.#size += 1;

    if (tick - this.#cursor < this.#horizon) {
      this.#place(tick, item);
    } else {
      this.#overflow.push(tick, item);
    }
  };

  readonly collect = (through: number, out: (Item | undefined)[]): number => {
    let count = 0;

    while (this.#cursor <= through) {
      const bucket = this.#buckets[this.#cursor % this.#horizon];

      if (bucket !== undefined) {
        count = this.#drainBucket(bucket, out, count);
      }

      this.#cursor += 1;
      this.#overflow.drain(this.#cursor + this.#horizon, this.#place);
    }

    clearFrom(out, count);

    return count;
  };

  /** Puts an item in its tick's bucket. */
  readonly #place = (tick: number, item: Item): void => {
    const bucket = this.#buckets[tick % this.#horizon];

    if (bucket !== undefined) {
      bucket.items[bucket.count] = item;
      bucket.count += 1;
    }
  };

  /** Moves one bucket's items into `out` from `at`, clearing the bucket; returns the next free index of `out`. */
  #drainBucket(bucket: Bucket<Item>, out: (Item | undefined)[], at: number): number {
    let next = at;

    for (let i = 0; i < bucket.count; i++) {
      out[next] = bucket.items[i];
      bucket.items[i] = undefined;
      next += 1;
    }

    this.#size -= bucket.count;
    bucket.count = 0;

    return next;
  }
}

/** Creates an empty timing wheel. */
export const createTimingWheel = <Item extends Defined>(options: TimingWheelOptions = {}): TimingWheel<Item> =>
  new Wheel<Item>(options);

/** The items beyond the horizon: a heap keyed by tick, with the scheduling order kept for items on the same tick. */
interface Overflow<Item extends Defined> {
  /** Adds an item due at `tick`. */
  readonly push: (tick: number, item: Item) => void;

  /** Hands every item due before `limit` to `admit`, by tick and then in the order they were pushed. */
  readonly drain: (limit: number, admit: (tick: number, item: Item) => void) => void;
}

/** Creates the overflow heap: slots in parallel arrays with a free list, ordered by tick and then by sequence. */
const createOverflow = <Item extends Defined>(): Overflow<Item> => {
  const heap = new FlatQueue();
  const items: (Item | undefined)[] = [];
  const ticks: number[] = [];
  const sequences: number[] = [];
  const free: number[] = [];
  const batch: number[] = [];
  let sequence = 0;

  const bySequence = (a: number, b: number): number =>
    (ticks[a] ?? 0) - (ticks[b] ?? 0) || (sequences[a] ?? 0) - (sequences[b] ?? 0);

  return {
    push: (tick, item) => {
      const slot = free.pop() ?? items.length;

      items[slot] = item;
      ticks[slot] = tick;
      sequences[slot] = sequence;
      sequence += 1;
      heap.push(slot, tick);
    },

    drain: (limit, admit) => {
      if (heap.length === 0 || (heap.peekValue() ?? limit) >= limit) {
        return;
      }

      batch.length = 0;

      while (heap.length > 0 && (heap.peekValue() ?? limit) < limit) {
        batch.push(heap.pop() ?? 0);
      }

      batch.sort(bySequence);

      for (const slot of batch) {
        const item = items[slot];

        items[slot] = undefined;
        free.push(slot);

        if (item !== undefined) {
          admit(ticks[slot] ?? 0, item);
        }
      }
    },
  };
};
