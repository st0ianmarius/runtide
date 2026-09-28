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

/** A pool's state: a class for fast properties, its functions arrow fields so they work detached. */
class ItemPool<Item extends Defined> implements Pool<Item> {
  readonly #create: () => Item;
  readonly #reset: ((item: Item) => void) | undefined;
  readonly #items: Item[] = [];
  readonly #generations: number[] = [];
  readonly #isAcquired: boolean[] = [];
  readonly #free: number[] = [];
  #live = 0;

  constructor(options: PoolOptions<Item>) {
    this.#create = options.create;
    this.#reset = options.reset;
  }

  get created(): number {
    return this.#items.length;
  }

  get live(): number {
    return this.#live;
  }

  readonly slotOf = (handle: number): number => handle % SLOT_SPAN;

  readonly isLive = (handle: number): boolean => {
    const slot = handle % SLOT_SPAN;

    return this.#isAcquired[slot] === true && this.#generations[slot] === Math.floor(handle / SLOT_SPAN);
  };

  readonly acquire = (): Handle<Item> => {
    const slot = this.#takeSlot();
    const generation = (this.#generations[slot] ?? 0) + 1;

    this.#generations[slot] = generation;
    this.#isAcquired[slot] = true;
    this.#live += 1;

    return toHandle<Item>(generation * SLOT_SPAN + slot);
  };

  readonly get = (handle: Handle<Item>): Item | undefined =>
    this.isLive(handle) ? this.#items[handle % SLOT_SPAN] : undefined;

  readonly release = (handle: Handle<Item>): boolean => {
    if (!this.isLive(handle)) {
      return false;
    }

    const slot = handle % SLOT_SPAN;
    const item = this.#items[slot];

    this.#isAcquired[slot] = false;
    this.#live -= 1;
    this.#free.push(slot);

    if (item !== undefined) {
      this.#reset?.(item);
    }

    return true;
  };

  /** A free slot, or a new one with a new item. */
  #takeSlot(): number {
    const slot = this.#free.pop();

    if (slot !== undefined) {
      return slot;
    }

    if (this.#items.length >= SLOT_SPAN) {
      throw new RangeError(`A pool holds at most ${SLOT_SPAN} items.`);
    }

    this.#items.push(this.#create());
    this.#generations.push(0);
    this.#isAcquired.push(false);

    return this.#items.length - 1;
  }
}

/** Creates an empty pool. */
export const createPool = <Item extends Defined>(options: PoolOptions<Item>): Pool<Item> => new ItemPool(options);
