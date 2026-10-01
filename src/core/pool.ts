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
 * A pool of reusable items with generational handles: a released slot is reused, and its generation rises,
 * so a handle kept past its release is detected as stale and never reaches the slot's next occupant. Released slots
 * are reused oldest first, so a slot comes round again only after every other free slot, and its generation wraps
 * after 2,047 reuses: a handle kept that long after its release could read as live again, so keep a handle no longer
 * than its item lives, as the systems do.
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

  /** The free slots, a queue from `#freeHead` to `#freeTail`: written by index, never shrunk, so it keeps its storage. */
  readonly #free: number[] = [];
  #freeHead = 0;
  #freeTail = 0;
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

  /** The oldest free slot, or a new one with a new item. */
  #takeSlot(): number {
    const free = this.#free;

    if (this.#freeHead < this.#freeTail) {
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
