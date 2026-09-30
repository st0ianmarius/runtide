// Asked on every position read and placement, so the probes are plain loops over typed arrays.

/** No key: an empty cell. */
const EMPTY = -1;

/** A cell's home for an id under a mask: Fibonacci hashing over the id's 32 bits. */
const homeOf = (id: number, mask: number): number => (Math.imul(id >>> 0, 0x9e3779b1) >>> 0) & mask;

/**
 * A map from entity ids (whole numbers below 2³²) to slots, open-addressed over typed arrays with linear probing and
 * backward-shift deletion: no object keys, no tombstones, and it doubles past half full. Ids are never reused, so an
 * array indexed by id would grow without bound; this stays the size of what is live.
 */
export class IdSlots {
  #keys = new Float64Array(64).fill(EMPTY);
  #slots = new Int32Array(64);
  #size = 0;

  /** How many ids it holds. */
  get size(): number {
    return this.#size;
  }

  /** The slot of an id, or -1. */
  get(id: number): number {
    const keys = this.#keys;
    const mask = keys.length - 1;

    for (let at = homeOf(id, mask); ; at = (at + 1) & mask) {
      const key = keys[at] ?? EMPTY;

      if (key === id) {
        return this.#slots[at] ?? -1;
      }

      if (key === EMPTY) {
        return -1;
      }
    }
  }

  /** Sets an id's slot. */
  set(id: number, slot: number): void {
    if ((this.#size + 1) * 2 > this.#keys.length) {
      this.#grow();
    }

    const keys = this.#keys;
    const mask = keys.length - 1;
    let at = homeOf(id, mask);

    while (keys[at] !== EMPTY && keys[at] !== id) {
      at = (at + 1) & mask;
    }

    if (keys[at] === EMPTY) {
      this.#size += 1;
    }

    keys[at] = id;
    this.#slots[at] = slot;
  }

  /** Forgets an id, shifting back the cells its probe run carried past it. */
  delete(id: number): void {
    const keys = this.#keys;
    const slots = this.#slots;
    const mask = keys.length - 1;
    let hole = homeOf(id, mask);

    while (keys[hole] !== id) {
      if (keys[hole] === EMPTY) {
        return;
      }

      hole = (hole + 1) & mask;
    }

    this.#size -= 1;

    for (let at = (hole + 1) & mask; keys[at] !== EMPTY; at = (at + 1) & mask) {
      const home = homeOf(keys[at] ?? 0, mask);

      // Move the cell back into the hole unless its home lies cyclically after the hole, up to it.
      if (((at - home) & mask) >= ((at - hole) & mask)) {
        keys[hole] = keys[at] ?? EMPTY;
        slots[hole] = slots[at] ?? -1;
        hole = at;
      }
    }

    keys[hole] = EMPTY;
  }

  /** Doubles the table, putting every id back. */
  #grow(): void {
    const keys = this.#keys;
    const slots = this.#slots;

    this.#keys = new Float64Array(keys.length * 2).fill(EMPTY);
    this.#slots = new Int32Array(keys.length * 2);
    this.#size = 0;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] ?? EMPTY;

      if (key !== EMPTY) {
        this.set(key, slots[i] ?? -1);
      }
    }
  }
}
