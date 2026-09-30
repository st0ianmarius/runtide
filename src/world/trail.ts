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

  /** The oldest tick it holds, NaN when empty: a rewind to an older one (a claimed lag past the window) is the game's to refuse. */
  get oldest(): number {
    return this.#count === 0 ? Number.NaN : (this.#ticks[this.#slot(this.#count)] ?? Number.NaN);
  }

  /** The newest tick it holds, NaN when empty. */
  get newest(): number {
    return this.#count === 0 ? Number.NaN : (this.#ticks[this.#slot(1)] ?? Number.NaN);
  }

  /**
   * Where the unit stood at a tick, into `out`: between two records (a fractional render time, or a tick with no
   * record), on the straight line between them; past the newest, the newest; before the oldest, the oldest (check
   * `oldest` first to refuse it). `undefined` for an empty trail.
   */
  at(tick: number, out: MutableVec2): Vec2 | undefined {
    let newer = -1;

    for (let i = 1; i <= this.#count; i++) {
      const slot = this.#slot(i);
      const at = this.#ticks[slot] ?? 0;

      if (at <= tick || i === this.#count) {
        return this.#between([slot, newer], tick, out);
      }

      newer = slot;
    }

    return undefined;
  }

  /** The slot `i` records back from the newest (1 for the newest). */
  #slot(i: number): number {
    const size = this.#ticks.length;

    return (this.#next - i + size) % size;
  }

  /** The position at `tick` from the record in `slot` toward the newer one in `newer` (-1 for none). */
  #between([slot, newer]: readonly [number, number], tick: number, out: MutableVec2): Vec2 {
    const t0 = this.#ticks[slot] ?? 0;
    const x0 = this.#xs[slot] ?? 0;
    const z0 = this.#zs[slot] ?? 0;

    if (newer < 0 || !(tick > t0)) {
      out.x = x0;
      out.z = z0;

      return out;
    }

    const share = (tick - t0) / ((this.#ticks[newer] ?? t0 + 1) - t0);

    out.x = x0 + ((this.#xs[newer] ?? x0) - x0) * share;
    out.z = z0 + ((this.#zs[newer] ?? z0) - z0) * share;

    return out;
  }

  /** Forgets every record (a unit teleported, or its pooled record reused). */
  clear(): void {
    this.#count = 0;
    this.#next = 0;
  }
}
