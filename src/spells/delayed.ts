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
import type { DelayBound } from './procs.ts';
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
  bound: DelayBound<G> | undefined = undefined;
  handle: Handle<Delayed<G>> = toHandle<Delayed<G>>(0);

  /** The tick its delay counts from. */
  anchor = 0;

  /** The seconds from the anchor to its due time. */
  offset = 0;

  /** Its tick slot. */
  slot = 0;

  /** Its index in the live list. */
  index = -1;

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

  /** Whether its owner still lets it land, asked as it falls due; it always lands when absent. */
  readonly bound?: DelayBound<G> | undefined;
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

  /** The lists waiting, in no order, each at its `index`: what `withdraw` walks. */
  readonly #live: Delayed<G>[] = [];
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
    record.bound = spec.bound;
    record.anchor = parent?.anchor ?? engine.clock.tick;
    record.offset = (parent?.offset ?? 0) + spec.seconds;
    record.slot = spec.slot ?? parent?.slot ?? 0;
    record.cast = engine.current;
    record.index = this.#live.length;
    this.#live.push(record);

    if (record.cast !== undefined) {
      record.cast.holds += 1;
    }

    const { dt } = engine.clock;
    const wheel = this.#wheels[record.slot] ?? missing(`tick slot ${record.slot}`);

    wheel.schedule(record.anchor + stepsUntil(record.offset, dt), handle);
  }

  /**
   * Lands every list of a slot due by the clock's tick, in due order, dropping unrun each whose bound its owner fails;
   * returns how many landed.
   */
  land(slot: number): number {
    const wheel = this.#wheels[slot] ?? missing(`tick slot ${slot}`);
    const due = this.#due.take();
    const count = wheel.collect(this.#engine.clock.tick, due);
    let landed = 0;

    try {
      for (let i = 0; i < count; i++) {
        const handle = due[i];
        const record = handle === undefined ? undefined : this.#pool.get(handle);

        if (record === undefined) {
          continue;
        }

        if (record.bound?.(record.cast?.caster ?? record.self) === false) {
          this.#free(record);
        } else {
          this.#landOne(record);
          landed += 1;
        }
      }
    } finally {
      this.#due.give(count);
    }

    return landed;
  }

  /**
   * Withdraws every list a unit owns that has not landed (§II.6 P3 `despawnOwned`): those its casts scheduled, and those
   * scheduled for it outside a cast. None of their procs run; returns how many it withdrew.
   */
  withdraw(owner: G['bearer']): number {
    const live = this.#live;
    let withdrawn = 0;

    for (let i = live.length - 1; i >= 0; i--) {
      const record = live[i];

      if (record !== undefined && (record.cast?.caster ?? record.self) === owner) {
        this.#free(record);
        withdrawn += 1;
      }
    }

    return withdrawn;
  }

  /**
   * Runs one list for its origin, as its cast's procs, then lets go of the cast and the record. It leaves the live list
   * first, so its own procs cannot withdraw it while it runs.
   */
  #landOne(record: Delayed<G>): void {
    const engine = this.#engine;
    const { current } = engine;
    const { landing } = this;

    this.#unlist(record);
    engine.current = record.cast;
    this.landing = record;

    try {
      engine.procs.run(record.procs, record);
    } finally {
      engine.current = current;
      this.landing = landing;
    }

    this.#release(record);
  }

  /** Lets go of a list that has not landed: out of the live list, then released. */
  #free(record: Delayed<G>): void {
    this.#unlist(record);
    this.#release(record);
  }

  /** Takes a list out of the live list, moving the last one into its place. */
  #unlist(record: Delayed<G>): void {
    const live = this.#live;
    const last = live.pop();

    if (last !== undefined && last !== record) {
      live[record.index] = last;
      last.index = record.index;
    }

    record.index = -1;
  }

  /** Gives a list's record back to the pool and lets go of its cast. */
  #release(record: Delayed<G>): void {
    const { cast } = record;

    record.cast = undefined;
    record.bound = undefined;
    record.procs = NO_PROCS;
    record.eventUnit = undefined;
    this.#pool.release(record.handle);

    if (cast !== undefined) {
      this.#engine.unhold(cast);
    }
  }
}
