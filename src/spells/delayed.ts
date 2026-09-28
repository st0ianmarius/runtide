import { NO_SOURCE } from '../auras/index.ts';
import { toHandle } from '../core/ids.ts';
import {
  createPool,
  createScratch,
  createTimingWheel,
  type Handle,
  type Pool,
  type Scratch,
  stepsUntil,
  type TimingWheel,
} from '../core/index.ts';
import type { Proc, ProcContext, ProcOrigin } from '../procs/index.ts';
import type { Cast } from './cast.ts';
import type { SpellEngine } from './engine.ts';
import { missing } from './missing.ts';
import type { SpellTypes } from './spell-types.ts';

/** No procs. */
const NO_PROCS: readonly never[] = Object.freeze([]);

/**
 * One delayed list of procs (§II.3.4: the lightest area trigger), pooled: the origin captured when it was scheduled
 * (self, target, event unit, credit), the procs, the cast it belongs to (held alive until it lands, §II.6 S6), and its
 * due time as an anchor tick plus seconds, so a chained delay is due from its parent's due time (§II.6 P5).
 */
class Delayed<G extends SpellTypes> implements ProcOrigin<G> {
  self: G['bearer'];
  target: G['bearer'];
  eventUnit: G['bearer'] | undefined = undefined;
  source = NO_SOURCE;
  procs: readonly Proc<G>[] = NO_PROCS;
  cast: Cast<G> | undefined = undefined;
  handle: Handle<Delayed<G>> = toHandle<Delayed<G>>(0);

  /** The tick its delay counts from. */
  anchor = 0;

  /** The seconds from the anchor to its due time. */
  offset = 0;

  /** Its tick slot. */
  slot = 0;

  constructor(self: G['bearer']) {
    this.self = self;
    this.target = self;
  }
}

/** When and where a delayed list is due. */
export interface DelaySpec<G extends SpellTypes> {
  /** Its seconds. */
  readonly seconds: number;

  /** The procs. */
  readonly procs: readonly Proc<G>[];

  /** `due` counts from the due time of the delayed list landing now, `now` (the default) from this tick. */
  readonly from?: 'now' | 'due' | undefined;

  /** Its tick slot; the landing list's slot for `due`, else 0. */
  readonly slot?: number | undefined;
}

/**
 * The delayed procs of one spell system (§I.5.4, §II.3.4): pooled records on one timing wheel per tick slot, so lists
 * due on the same tick land in the order they were scheduled, the host landing each slot where its loop needs it.
 */
export class DelayedProcs<G extends SpellTypes> {
  readonly #engine: SpellEngine<G>;
  readonly #pool: Pool<Delayed<G>>;
  readonly #wheels: readonly TimingWheel<Handle<Delayed<G>>>[];
  readonly #due: Scratch<Handle<Delayed<G>>> = createScratch();
  #pending: G['bearer'] | undefined = undefined;

  /** The delayed list landing now, which a `due` delay counts from; none outside a landing. */
  landing: Delayed<G> | undefined = undefined;

  constructor(engine: SpellEngine<G>, slots: number) {
    this.#engine = engine;
    this.#pool = createPool({ create: () => new Delayed<G>(this.#pending ?? missing('a unit')) });
    this.#wheels = Array.from({ length: slots }, () => createTimingWheel({ start: engine.clock.tick }));
  }

  /** How many lists wait to land, over every slot. */
  get size(): number {
    return this.#pool.live;
  }

  /** How many records the pool has made: a steady state makes no new ones. */
  get created(): number {
    return this.#pool.created;
  }

  /** How many tick slots there are. */
  get slots(): number {
    return this.#wheels.length;
  }

  /**
   * Schedules a list for the origin of the running proc context, held by the cast whose procs are running (if any),
   * due `seconds` from now or from the landing list's due time.
   */
  schedule(ctx: ProcContext<G>, spec: DelaySpec<G>): void {
    const engine = this.#engine;
    const parent = spec.from === 'due' ? this.landing : undefined;

    this.#pending = ctx.self;

    const handle = this.#pool.acquire();
    const record = this.#pool.get(handle) ?? missing('a pooled delay');

    this.#pending = undefined;
    record.handle = handle;
    record.self = ctx.self;
    record.target = ctx.target;
    record.eventUnit = ctx.eventUnit;
    record.source = ctx.source;
    record.procs = spec.procs;
    record.anchor = parent?.anchor ?? engine.clock.tick;
    record.offset = (parent?.offset ?? 0) + spec.seconds;
    record.slot = spec.slot ?? parent?.slot ?? 0;
    record.cast = engine.current;

    if (record.cast !== undefined) {
      record.cast.holds += 1;
    }

    const { dt, countdown } = engine.clock;
    const wheel = this.#wheels[record.slot] ?? missing(`tick slot ${record.slot}`);

    wheel.schedule(record.anchor + stepsUntil(record.offset, dt, countdown), handle);
  }

  /** Lands every list of a slot due by the clock's tick, in due order; returns how many landed. */
  land(slot: number): number {
    const wheel = this.#wheels[slot] ?? missing(`tick slot ${slot}`);
    const due = this.#due.take();
    const count = wheel.collect(this.#engine.clock.tick, due);

    try {
      for (let i = 0; i < count; i++) {
        const handle = due[i];
        const record = handle === undefined ? undefined : this.#pool.get(handle);

        if (record !== undefined) {
          this.#landOne(record);
        }
      }
    } finally {
      this.#due.give(count);
    }

    return count;
  }

  /** Runs one list for its origin, as its cast's procs, then lets go of the cast and the record. */
  #landOne(record: Delayed<G>): void {
    const engine = this.#engine;
    const { current } = engine;
    const { landing } = this;

    engine.current = record.cast;
    this.landing = record;

    try {
      engine.procs.run(record.procs, record);
    } finally {
      engine.current = current;
      this.landing = landing;
    }

    const { cast } = record;

    record.cast = undefined;
    record.procs = NO_PROCS;
    record.eventUnit = undefined;
    this.#pool.release(record.handle);

    if (cast !== undefined) {
      engine.unhold(cast);
    }
  }
}
