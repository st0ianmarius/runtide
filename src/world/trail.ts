import type { MutableVec2, Vec2 } from '../math/index.ts';

/**
 * A unit's recent positions, one per tick, in a ring of fixed size: what lag compensation reads to test a hit
 * against where a client saw the unit (`at(tick)`, the tick the client's view showed), not where it stands now. The
 * game keeps one on each unit it may rewind and records it once a tick, after the world moved.
 */
export class Trail {
  readonly #ticks: Float64Array;
  readonly #xs: Float64Array;
  readonly #zs: Float64Array;
  #count = 0;
  #next = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`A trail holds a whole number of ticks from 1; got ${capacity}.`);
    }

    this.#ticks = new Float64Array(capacity);
    this.#xs = new Float64Array(capacity);
    this.#zs = new Float64Array(capacity);
  }

  /** How many ticks it holds. */
  get size(): number {
    return this.#count;
  }

  /** Records where the unit stands on a tick, later than the last recorded; the oldest goes past the capacity. */
  record(tick: number, at: Vec2): void {
    const last =
      this.#count === 0 ? -1 : (this.#ticks[(this.#next - 1 + this.#ticks.length) % this.#ticks.length] ?? -1);

    if (!(tick > last)) {
      throw new RangeError(`A trail records ticks in order; got ${tick} after ${last}.`);
    }

    this.#ticks[this.#next] = tick;
    this.#xs[this.#next] = at.x;
    this.#zs[this.#next] = at.z;
    this.#next = (this.#next + 1) % this.#ticks.length;
    this.#count = Math.min(this.#count + 1, this.#ticks.length);
  }

  /**
   * Where the unit stood on a tick, into `out`: the latest recorded at or before it (a tick with no record keeps the
   * one before), the oldest held for one older than the trail. `undefined` for an empty trail.
   */
  at(tick: number, out: MutableVec2): Vec2 | undefined {
    const size = this.#ticks.length;
    let found = -1;

    for (let i = 1; i <= this.#count; i++) {
      const slot = (this.#next - i + size) % size;

      found = slot;

      if ((this.#ticks[slot] ?? 0) <= tick) {
        break;
      }
    }

    if (found < 0) {
      return undefined;
    }

    out.x = this.#xs[found] ?? 0;
    out.z = this.#zs[found] ?? 0;

    return out;
  }

  /** Forgets every record (a unit teleported, or its pooled record reused). */
  clear(): void {
    this.#count = 0;
    this.#next = 0;
  }
}
