import type { Defined } from './defined.ts';
import { type Handle, toHandle } from './ids.ts';

/** How many bits of a handle hold its slot: a pool addresses up to 2^20 (1,048,576) items. */
const SLOT_BITS = 20;

/** How many slots a pool can address. */
const SLOT_SPAN = 2 ** SLOT_BITS;

/** The slot bits of a handle. */
const SLOT_MASK = SLOT_SPAN - 1;

/**
 * How many generations a slot counts before it wraps (to 1: generation 0 is never handed out, so `NO_HANDLE` never
 * points at anything). Slot and generation fit 31 bits, so a handle stays a small integer, which V8 keeps unboxed and
 * reads with bit operations; a larger handle would be a heap number read through float division.
 */
const GENERATIONS = 2 ** (31 - SLOT_BITS) - 1;

/**
 * How many released slots a pool keeps waiting before it reuses the oldest, by default. Once that many are free, at
 * least that many other acquisitions come between two occupants of one slot, so its generation wraps only after
 * 2,047 × 1,024 (about 2.1 million) acquisitions, not after 2,047 when a nearly full pool cycles its one free slot. A
 * steady state then holds up to this many items beyond its peak of live ones.
 */
export const POOL_MIN_FREE = 1024;

/** A handle that never points at anything: slot 0 at generation 0, which no acquire returns. */
export const NO_HANDLE = 0;

/** What a pool is created from. */
export interface PoolOptions<Item> {
  /** Makes a new item when no released one is free; each call is counted in `created`. */
  readonly create: () => Item;

  /** Resets an item as it is released, so the next acquire gets it clean. */
  readonly reset?: (item: Item) => void;

  /**
   * How many released slots wait before the oldest is reused (`POOL_MIN_FREE` by default); below it, acquiring makes
   * a new item. 0 reuses a slot as soon as one is free, and wraps its generation after 2,047 reuses.
   */
  readonly minFree?: number;
}

/**
 * A pool of reusable items with generational handles: a released slot is reused, and its generation rises,
 * so a handle kept past its release is detected as stale and never reaches the slot's next occupant. Released slots
 * are reused oldest first, and only while more than `minFree` of them wait, so a slot comes round again only after at
 * least that many other acquisitions. Its generation wraps after 2,047 reuses: a handle kept that long after its
 * release (2,047 × `minFree` acquisitions at the least) could read as live again, so keep a handle no longer than its
 * item lives, as the systems do.
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

  /**
   * Puts `item` behind a live handle in place of the item there, and returns that one (a record filled outside the
   * pool, moved in once it is kept, with the pool's own taking its place outside); throws for a stale handle.
   */
  readonly swap: (handle: Handle<Item>, item: Item) => Item;

  /** Releases the item behind `handle`; returns false, and changes nothing, for a stale handle. */
  readonly release: (handle: Handle<Item>) => boolean;

  /** The slot index behind a handle, for side tables indexed by slot. */
  readonly slotOf: (handle: Handle<Item>) => number;
}

/** A pool's state: a class for fast properties, its functions arrow fields so they work detached. */
class ItemPool<Item extends Defined> implements Pool<Item> {
  readonly #create: () => Item;
  readonly #reset: ((item: Item) => void) | undefined;
  readonly #minFree: number;
  readonly #items: Item[] = [];
  readonly #generations: number[] = [];
  readonly #isAcquired: boolean[] = [];

  /** The free slots, a queue from `#freeHead` to `#freeTail`: written by index, never shrunk, so it keeps its storage. */
  readonly #free: number[] = [];
  #freeHead = 0;
  #freeTail = 0;
  #live = 0;

  constructor(options: PoolOptions<Item>) {
    this.#create = options.create;
    this.#reset = options.reset;
    this.#minFree = options.minFree ?? POOL_MIN_FREE;

    if (!Number.isInteger(this.#minFree) || this.#minFree < 0) {
      throw new RangeError(`A pool's minFree is a whole number from 0, not ${this.#minFree}.`);
    }
  }

  get created(): number {
    return this.#items.length;
  }

  get live(): number {
    return this.#live;
  }

  readonly slotOf = (handle: number): number => handle & SLOT_MASK;

  readonly isLive = (handle: number): boolean => {
    const slot = handle & SLOT_MASK;

    return this.#isAcquired[slot] === true && this.#generations[slot] === handle >>> SLOT_BITS;
  };

  readonly acquire = (): Handle<Item> => {
    const slot = this.#takeSlot();
    const generation = ((this.#generations[slot] ?? 0) % GENERATIONS) + 1;

    this.#generations[slot] = generation;
    this.#isAcquired[slot] = true;
    this.#live += 1;

    return toHandle<Item>((generation << SLOT_BITS) | slot);
  };

  readonly get = (handle: Handle<Item>): Item | undefined =>
    this.isLive(handle) ? this.#items[handle & SLOT_MASK] : undefined;

  readonly swap = (handle: Handle<Item>, item: Item): Item => {
    const slot = handle & SLOT_MASK;
    const held = this.isLive(handle) ? this.#items[slot] : undefined;

    if (held === undefined) {
      throw new RangeError('A pool swaps the item behind a live handle only.');
    }

    this.#items[slot] = item;

    return held;
  };

  readonly release = (handle: Handle<Item>): boolean => {
    if (!this.isLive(handle)) {
      return false;
    }

    const slot = handle & SLOT_MASK;
    const item = this.#items[slot];

    this.#isAcquired[slot] = false;
    this.#live -= 1;
    this.#free[this.#freeTail] = slot;
    this.#freeTail += 1;

    if (item !== undefined) {
      this.#reset?.(item);
    }

    return true;
  };

  /** The oldest free slot while more than `minFree` wait, else a new one with a new item. */
  #takeSlot(): number {
    const free = this.#free;

    if (this.#freeTail - this.#freeHead > this.#minFree) {
      const slot = free[this.#freeHead] ?? 0;

      this.#freeHead += 1;

      // Emptied, the queue starts over at 0; long, its taken front moves out. `length = 0` would drop the storage, and
      // the next release would allocate it again.
      if (this.#freeHead === this.#freeTail) {
        this.#freeHead = 0;
        this.#freeTail = 0;
      } else if (this.#freeHead >= 1024 && this.#freeHead * 2 >= this.#freeTail) {
        free.copyWithin(0, this.#freeHead, this.#freeTail);
        this.#freeTail -= this.#freeHead;
        this.#freeHead = 0;
      }

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
