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
  type TimingWheel
} from '../core/index.ts';
import { frameOf } from '../procs/frame.ts';
import type { Proc, ProcContext, ProcOrigin } from '../procs/index.ts';
import type { Cast } from './cast.ts';
import type { SpellEngine } from './engine.ts';
import { missing } from './missing.ts';
import type { DelayBound } from './procs.ts';
import type { SpellTypes } from './spell-types.ts';

/** No procs. */
const NO_PROCS: readonly never[] = Object.freeze([]);

/**
 * One delayed list of procs (the lightest area trigger), pooled: the origin captured when it was scheduled (self,
 * target, event unit, other unit, credit; not its aura, whose slot may be another's by the time it lands), the procs,
 * the cast it belongs to (held alive until it lands), and its due time as an anchor tick plus seconds, so a chained
 * delay is due from its parent's due time.
 */
export class Delayed<G extends SpellTypes> implements ProcOrigin<G> {
  self: G['bearer'];
  target: G['bearer'];
  eventUnit: G['bearer'] | undefined = undefined;
  other: G['bearer'] | undefined = undefined;
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

  /** The tick it lands on: its wheel tick, or the wheel's cursor for one scheduled late. */
  due = 0;

  /** Its place in scheduling order over every slot: lists due on the same tick and slot land in this order. */
  sequence = 0;

  /** Its index in the live list. */
  index = -1;

  /** Whether it was withdrawn: its slot waits, emptied, for its entry on the wheel to come due before it is reused. */
  isWithdrawn = false;

  /** Its captured owner, for bounds and withdrawal, independent of its cast and origin; `undefined` for none. */
  owner: G['bearer'] | undefined;

  constructor(self: G['bearer']) {
    this.self = self;
    this.owner = self;
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

  /**
   * Its bearer, a self/source selector, or `none` (unowned); otherwise inherited from a parent delay, or the cast's
   * caster/list's self.
   */
  readonly owner?: 'self' | 'source' | 'none' | G['bearer'] | undefined;

  /** Whether its owner still lets it land, asked as it falls due; it always lands when absent. */
  readonly bound?: DelayBound<G> | undefined;
}

/** Throws a `TypeError` for an unowned list with a bound: there is nobody to ask. */
const checkBound = <G extends SpellTypes>(owner: G['bearer'] | undefined, spec: DelaySpec<G>): void => {
  if (owner === undefined && spec.bound !== undefined) {
    throw new TypeError("an unowned after proc (owner 'none', or a follow-up of one) has no owner to ask its bound.");
  }
};

/**
 * The delayed procs of one spell system: pooled records on one timing wheel per tick slot, so lists
 * due on the same tick land in the order they were scheduled, the host landing each slot where its loop needs it.
 */
export class DelayedProcs<G extends SpellTypes> {
  readonly #engine: SpellEngine<G>;
  readonly #pool: Pool<Delayed<G>>;
  readonly #wheels: readonly TimingWheel<Handle<Delayed<G>>>[];
  readonly #due: Scratch<Handle<Delayed<G>>> = createScratch();

  /** The lists waiting, in no order, each at its `index`: what `withdraw` walks. */
  readonly #live: Delayed<G>[] = [];

  /** How many lists wait per owner: a withdrawal for an owner with none (most deaths) walks nothing. */
  readonly #owned = new Map<G['bearer'], number>();
  #pending: G['bearer'] | undefined = undefined;

  /** The delayed list landing now, which a `due` delay counts from; none outside a landing. */
  landing: Delayed<G> | undefined = undefined;

  /** How many lists were ever scheduled: the next one's `sequence`. */
  #sequence = 0;

  constructor(engine: SpellEngine<G>, slots: number) {
    this.#engine = engine;
    this.#pool = createPool({ create: () => new Delayed<G>(this.#pending ?? missing('a unit')) });
    this.#wheels = Array.from({ length: slots }, () => createTimingWheel({ start: engine.clock.tick }));
  }

  /** How many withdrawn lists' slots wait for their wheel entries, so no stale entry can reach a reused slot. */
  #withdrawn = 0;

  /** How many lists wait to land, over every slot. */
  get size(): number {
    return this.#pool.live - this.#withdrawn;
  }

  /** How many records the pool has made: a steady state makes no new ones. */
  get created(): number {
    return this.#pool.created;
  }

  /** How many tick slots there are. */
  get slots(): number {
    return this.#wheels.length;
  }

  /** The lists waiting, in no order (a digest sorts them by `due`, `slot` and `sequence`); read, never written. */
  get live(): readonly Delayed<G>[] {
    return this.#live;
  }

  /**
   * Schedules a list for the origin of the running proc context, held by the cast the running list belongs to (if any),
   * due `seconds` from now or from the landing list's due time. Returns false when a source owner cannot be resolved,
   * and for an owned list whose owner has left life (the host's `isGone`): its leave-life withdrawal ran already, so
   * the list is refused rather than left to land after it. Throws a `TypeError` for an unowned list with a bound: there
   * is nobody to ask.
   */
  schedule(ctx: ProcContext<G>, spec: DelaySpec<G>): boolean {
    const engine = this.#engine;
    const parent = spec.from === 'due' ? this.landing : undefined;
    const cast = engine.castFor(ctx);
    const owner = this.#presentOwnerFor(ctx, spec, cast);

    if (owner === false) {
      return false;
    }

    checkBound(owner, spec);

    this.#pending = ctx.self;

    const handle = this.#pool.acquire();
    const record = this.#pool.get(handle) ?? missing('a pooled delay');

    this.#pending = undefined;
    record.handle = handle;
    record.self = ctx.self;
    record.target = ctx.target;
    record.eventUnit = ctx.eventUnit;
    record.other = ctx.other;
    record.source = ctx.source;
    record.procs = spec.procs;
    record.bound = spec.bound;
    record.anchor = parent?.anchor ?? engine.clock.tick;
    record.offset = (parent?.offset ?? 0) + spec.seconds;
    record.slot = spec.slot ?? parent?.slot ?? 0;
    this.#list(record, cast, owner);

    const { dt } = engine.clock;
    const wheel = this.#wheels[record.slot] ?? missing(`tick slot ${record.slot}`);

    const at = record.anchor + stepsUntil(record.offset, dt);

    // Where the wheel files it: a tick it collected already is late, and lands at its cursor.
    record.due = Math.max(Math.trunc(at), wheel.cursor);
    record.sequence = this.#sequence;
    this.#sequence += 1;
    wheel.schedule(at, handle);

    return true;
  }

  /**
   * Lands every list of a slot due by the clock's tick, in due order, dropping unrun each whose bound its owner fails;
   * returns how many landed. A list that throws stops the landing: the lists due after it are dropped unrun, so none is
   * left off the wheel holding its cast.
   */
  land(slot: number): number {
    const wheel = this.#wheels[slot] ?? missing(`tick slot ${slot}`);
    const due = this.#due.take();
    const count = wheel.collect(this.#engine.clock.tick, due);
    let landed = 0;
    let i = 0;

    try {
      for (; i < count; i++) {
        const handle = due[i];
        const record = handle === undefined ? undefined : this.#pool.get(handle);

        if (record?.isWithdrawn === true) {
          this.#reclaim(record);
        } else if (record !== undefined && this.#landDue(record)) {
          landed += 1;
        }
      }
    } catch (error) {
      this.#dropDue(due, i + 1, count);

      throw error;
    } finally {
      this.#due.give(count);
    }

    return landed;
  }

  /**
   * Withdraws every list with this captured owner that has not landed (`despawnOwned`). None of their procs run;
   * returns how many it withdrew. Each lets go of its cast
   * and procs at once, but keeps its slot until its entry on the wheel comes due, so that entry never reaches a list
   * scheduled since in a reused slot.
   */
  withdraw(owner: G['bearer']): number {
    const live = this.#live;
    let withdrawn = 0;

    if (!this.#owned.has(owner)) {
      return 0;
    }

    for (let i = live.length - 1; i >= 0; i--) {
      const record = live[i];

      if (record?.owner === owner) {
        this.#unlist(record);
        this.#letGo(record);
        record.isWithdrawn = true;
        this.#withdrawn += 1;
        withdrawn += 1;
      }
    }

    return withdrawn;
  }

  /**
   * Lands one due list, or drops it unrun when its bound fails; whether it landed. It leaves the live list first, so
   * neither its bound nor its own procs can withdraw it while it is asked or runs.
   */
  #landDue(record: Delayed<G>): boolean {
    let lands = false;

    this.#unlist(record);

    // Released when its bound fails or throws: out of the live list already, nothing else would let it go.
    try {
      const { owner } = record;

      lands = owner === undefined || record.bound?.(owner, record) !== false;
    } finally {
      if (!lands) {
        this.#release(record);
      }
    }

    if (lands) {
      this.#landOne(record);
    }

    return lands;
  }

  /** Runs one list, out of the live list already, for its origin as its cast's procs, then lets go of it. */
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
      this.#release(record);
    }
  }

  /** Drops unrun the due lists from `from` on, still waiting after a list threw. */
  #dropDue(due: readonly (Handle<Delayed<G>> | undefined)[], from: number, count: number): void {
    for (let i = from; i < count; i++) {
      const handle = due[i];
      const record = handle === undefined ? undefined : this.#pool.get(handle);

      if (record?.isWithdrawn === true) {
        this.#reclaim(record);
      } else if (record !== undefined) {
        this.#free(record);
      }
    }
  }

  /** Gives a withdrawn list's slot back to the pool, its wheel entry collected. */
  #reclaim(record: Delayed<G>): void {
    record.isWithdrawn = false;
    this.#withdrawn -= 1;
    this.#pool.release(record.handle);
  }

  /** Lets go of a list that has not landed: out of the live list, then released. */
  #free(record: Delayed<G>): void {
    this.#unlist(record);
    this.#release(record);
  }

  /** `#ownerFor`, or false for an owner that has left life (the host's `isGone`): its withdrawal ran already. */
  #presentOwnerFor(
    ctx: ProcContext<G>,
    spec: DelaySpec<G>,
    cast: Cast<G> | undefined
  ): G['bearer'] | undefined | false {
    const owner = this.#ownerFor(ctx, spec, cast);

    return owner !== undefined && owner !== false && this.#engine.host.isGone?.(owner) === true ? false : owner;
  }

  /**
   * Captures ownership independently of cast retention; only the landing list's own descendants inherit it. `undefined`
   * for an unowned list; false when a source owner cannot be resolved.
   */
  #ownerFor(ctx: ProcContext<G>, spec: DelaySpec<G>, cast: Cast<G> | undefined): G['bearer'] | undefined | false {
    if (spec.owner === 'self') {
      return ctx.self;
    }

    if (spec.owner === 'none') {
      return undefined;
    }

    if (spec.owner === 'source') {
      if (ctx.source === NO_SOURCE) {
        return false;
      }

      if (ctx.host.unitOf === undefined) {
        throw new TypeError("an after proc owned by source needs the proc host's unitOf service.");
      }

      return ctx.host.unitOf(ctx.source) ?? false;
    }

    if (spec.owner !== undefined) {
      return spec.owner;
    }

    if (this.landing !== undefined && frameOf(ctx).origin === this.landing) {
      return this.landing.owner;
    }

    return cast?.caster ?? ctx.self;
  }

  /** Puts a list in the live list, held by its cast (if any), and counts it for its owner, when it has one. */
  #list(record: Delayed<G>, cast: Cast<G> | undefined, owner: G['bearer'] | undefined): void {
    record.cast = cast;
    record.owner = owner;
    record.index = this.#live.length;
    this.#live.push(record);

    if (owner !== undefined) {
      this.#owned.set(owner, (this.#owned.get(owner) ?? 0) + 1);
    }

    if (cast !== undefined) {
      cast.holds += 1;
    }
  }

  /** Takes a list out of the live list, moving the last one into its place. */
  #unlist(record: Delayed<G>): void {
    const live = this.#live;
    const { owner } = record;

    if (owner !== undefined) {
      const left = (this.#owned.get(owner) ?? 1) - 1;

      if (left > 0) {
        this.#owned.set(owner, left);
      } else {
        this.#owned.delete(owner);
      }
    }

    const last = live.pop();

    if (last !== undefined && last !== record) {
      live[record.index] = last;
      last.index = record.index;
    }

    record.index = -1;
  }

  /** Gives a list's record back to the pool and lets go of its cast. */
  #release(record: Delayed<G>): void {
    this.#pool.release(record.handle);
    this.#letGo(record);
  }

  /** Lets go of what a list points at: its cast (one hold), its procs, its bound and its units. */
  #letGo(record: Delayed<G>): void {
    const { cast } = record;

    record.cast = undefined;
    record.bound = undefined;
    record.procs = NO_PROCS;
    record.eventUnit = undefined;
    record.other = undefined;

    if (cast !== undefined) {
      this.#engine.unhold(cast);
    }
  }
}
