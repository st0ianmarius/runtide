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
 * A timing wheel over a fixed-step clock (§I.5.4): one FIFO bucket per tick over a fixed horizon, so scheduling and
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
   * Empties `out`, then fills it with every item due up to and including tick `through`, tick by tick, each tick's
   * items in scheduling order, and moves the cursor past `through`. Returns `out`.
   */
  readonly collect: (through: number, out: Item[]) => Item[];
}

/** The smallest power of two at or above `n`, and at least 1. */
const powerOfTwo = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Creates an empty timing wheel. */
export const createTimingWheel = <Item extends Defined>(options: TimingWheelOptions = {}): TimingWheel<Item> => {
  const horizon = powerOfTwo(options.horizon ?? 256);
  const buckets: Item[][] = Array.from({ length: horizon }, () => []);
  const overflow = createOverflow<Item>();
  let cursor = options.start ?? 0;
  let size = 0;

  const bucketAt = (tick: number): Item[] => buckets[tick % horizon] ?? [];

  const place = (tick: number, item: Item): void => {
    bucketAt(tick).push(item);
  };

  return {
    get cursor() {
      return cursor;
    },

    get size() {
      return size;
    },

    schedule: (at, item) => {
      if (!Number.isFinite(at)) {
        throw new RangeError(`A timer needs a finite tick; got ${at}.`);
      }

      const tick = Math.max(Math.trunc(at), cursor);

      size += 1;

      if (tick - cursor < horizon) {
        bucketAt(tick).push(item);
      } else {
        overflow.push(tick, item);
      }
    },

    collect: (through, out) => {
      out.length = 0;

      while (cursor <= through) {
        const bucket = bucketAt(cursor);

        for (const item of bucket) {
          out.push(item);
        }

        size -= bucket.length;
        bucket.length = 0;
        cursor += 1;
        overflow.drain(cursor + horizon, place);
      }

      return out;
    },
  };
};

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
