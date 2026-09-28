import type { Defined } from './defined.ts';
import { type Handle, toHandle } from './ids.ts';

/** How many slots a pool can address: a handle packs the slot below this and the generation above it. */
const SLOT_SPAN = 2 ** 22;

/** A handle that never points at anything: slot 0 at generation 0, which no acquire returns. */
export const NO_HANDLE = 0;

/** What a pool is created from. */
export interface PoolOptions<Item> {
  /** Makes a new item when no released one is free; each call is counted in `created`. */
  readonly create: () => Item;

  /** Resets an item as it is released, so the next acquire gets it clean. */
  readonly reset?: (item: Item) => void;
}

/**
 * A pool of reusable items with generational handles (§I.5.4): a released slot is reused, and its generation rises,
 * so a handle kept past its release is detected as stale and never reaches the slot's next occupant.
 */
export interface Pool<Item extends Defined> {
  /** How many items the pool has ever made: a steady-state tick that allocates nothing leaves it unchanged. */
  readonly created: number;

  /** How many items are live (acquired and not released). */
  readonly live: number;

  /** Takes a free item (made when none is free) and returns its handle. */
  readonly acquire: () => Handle<Item>;

  /** The live item behind `handle`, or `undefined` when the handle is stale or was never valid. */
  readonly get: (handle: Handle<Item>) => Item | undefined;

  /** Whether `handle` still points at a live item. */
  readonly isLive: (handle: Handle<Item>) => boolean;

  /** Releases the item behind `handle`; returns false, and changes nothing, for a stale handle. */
  readonly release: (handle: Handle<Item>) => boolean;

  /** The slot index behind a handle, for side tables indexed by slot. */
  readonly slotOf: (handle: Handle<Item>) => number;
}

/** Creates an empty pool. */
export const createPool = <Item extends Defined>(options: PoolOptions<Item>): Pool<Item> => {
  const items: Item[] = [];
  const generations: number[] = [];
  const isAcquired: boolean[] = [];
  const free: number[] = [];
  let live = 0;

  const slotOf = (handle: number): number => handle % SLOT_SPAN;

  const isLive = (handle: number): boolean => {
    const slot = slotOf(handle);

    return isAcquired[slot] === true && generations[slot] === Math.floor(handle / SLOT_SPAN);
  };

  const takeSlot = (): number => {
    const slot = free.pop();

    if (slot !== undefined) {
      return slot;
    }

    if (items.length >= SLOT_SPAN) {
      throw new RangeError(`A pool holds at most ${SLOT_SPAN} items.`);
    }

    items.push(options.create());
    generations.push(0);
    isAcquired.push(false);

    return items.length - 1;
  };

  return {
    get created() {
      return items.length;
    },

    get live() {
      return live;
    },

    acquire: () => {
      const slot = takeSlot();
      const generation = (generations[slot] ?? 0) + 1;

      generations[slot] = generation;
      isAcquired[slot] = true;
      live += 1;

      return toHandle<Item>(generation * SLOT_SPAN + slot);
    },

    get: (handle) => (isLive(handle) ? items[slotOf(handle)] : undefined),
    isLive,

    release: (handle) => {
      if (!isLive(handle)) {
        return false;
      }

      const slot = slotOf(handle);
      const item = items[slot];

      isAcquired[slot] = false;
      live -= 1;
      free.push(slot);

      if (item !== undefined) {
        options.reset?.(item);
      }

      return true;
    },

    slotOf,
  };
};
