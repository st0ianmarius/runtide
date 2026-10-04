import type { MutableVec2, Vec2 } from '../math/index.ts';

/**
 * A unit's recent positions as they were replicated, in a ring of fixed size: what lag compensation reads to test a
 * hit against where a client drew the unit (`at(tick)`, the fractional tick the client's view showed), not where it
 * stands now. The game keeps one on each unit it may rewind and records the position each replication sends, at the
 * tick it was sent (every tick, or every few ticks at a reduced send rate), so a rewind tests exactly what the client
 * interpolated between: `at` reads the straight line between two records however many ticks apart they are.
 * `rewoundQuery` reads a world through them.
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

  /**
   * Records where the unit stood as a replication sent it, on the tick it was sent: finite and later than the last
   * recorded (any tick, negative ones included, when it is empty); the oldest goes past the capacity.
   */
  record(tick: number, at: Vec2): void {
    if (!Number.isFinite(tick)) {
      throw new RangeError(`A trail records finite ticks; got ${tick}.`);
    }

    const last = this.newest;

    if (this.#count > 0 && !(tick > last)) {
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
   * `oldest` first to refuse it). `undefined` for an empty trail. Throws for a NaN tick, which has no place on it.
   */
  at(tick: number, out: MutableVec2): Vec2 | undefined {
    let newer = -1;

    if (Number.isNaN(tick)) {
      throw new RangeError('A trail is read at a tick; got NaN.');
    }

    for (let i = 1; i <= this.#count; i++) {
      const slot = this.#slot(i);
      const at = this.#ticks[slot] ?? 0;

      if (at <= tick || i === this.#count) {
        return this.#between(slot, newer, tick, out);
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
  #between(slot: number, newer: number, tick: number, out: MutableVec2): Vec2 {
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
