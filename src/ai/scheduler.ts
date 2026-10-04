import { toId } from '../core/ids.ts';
import { createTimingWheel, stepsUntil, type TimingWheel } from '../core/index.ts';
import type { SpellClock } from '../spells/index.ts';
import type { AiTypes, TimerId } from './ai-types.ts';
import { Brain, brainOf } from './brain.ts';
import { MAX_TIMERS } from './timers.ts';

/**
 * The most brains one system holds at once. A wheel entry is `(start × SLOT_SPAN + slot) × MAX_TIMERS + timer`, a safe
 * integer: `start` counts the timer's starts, so an entry left by a start since stopped never fires a later one.
 */
const SLOT_SPAN = 2 ** 20;

/** How many starts of one timer the entries tell apart before the count wraps. */
const STARTS = 2 ** 27;

/** No timer: the entry's timer field. */
const NONE = Number.NaN;

/**
 * Taken off a held collected timer's stamp: it goes back on the wheel ahead of every timer started since, as it was
 * handed out before them. Stamps stay below it, so the difference is exact.
 */
const COLLECTED_FIRST = 2 ** 53;

/**
 * The timers of every brain of one AI system (TrinityCore's `EventMap`): each running timer is one entry
 * on a timing wheel, so a unit with nothing due costs nothing per tick, and timers due on the same tick fire in the
 * order they were started. A held brain's timers stop counting and start again from where they were.
 */
export class Scheduler<G extends AiTypes> {
  readonly #clock: SpellClock;
  readonly #timers: number;
  readonly #wheel: TimingWheel<number>;
  readonly #brains: Brain[] = [];
  readonly #owners: (G['bearer'] | undefined)[] = [];
  readonly #isLive: boolean[] = [];
  readonly #free: number[] = [];
  readonly #due: (number | undefined)[] = [];

  /** The held timers of the brain being let go, sorted by stamp: reused, so a thaw allocates nothing. */
  readonly #order: Uint8Array;

  /** The next start stamp, counted across every brain. */
  #stamp = 0;

  constructor(clock: SpellClock, timers: number) {
    this.#clock = clock;
    this.#timers = timers;
    this.#order = new Uint8Array(timers);
    this.#wheel = createTimingWheel({ start: clock.tick });
  }

  /** How many brains are live. */
  get live(): number {
    return this.#brains.length - this.#free.length;
  }

  /** How many brain slots were ever made. */
  get created(): number {
    return this.#brains.length;
  }

  /** A new brain, from a freed slot when there is one. */
  create(): Brain {
    const slot = this.#free.pop();

    if (slot !== undefined) {
      this.#isLive[slot] = true;

      return this.#brains[slot] ?? missingSlot(slot);
    }

    if (this.#brains.length >= SLOT_SPAN) {
      throw new RangeError(`An AI system holds at most ${SLOT_SPAN} brains.`);
    }

    const brain = new Brain(this.#brains.length, this.#timers);

    this.#brains.push(brain);
    this.#isLive.push(true);

    return brain;
  }

  /** Frees a unit's brain: its timers stop, and its slot goes to the next brain made. False when already freed. */
  release(unit: G['bearer']): boolean {
    const brain = brainOf(unit.brain);

    if (!this.#isLiveBrain(brain)) {
      return false;
    }

    for (let timer = 0; timer < this.#timers; timer++) {
      this.#stop(brain, timer);
      brain.left[timer] = NONE;
    }

    brain.holds = 0;
    brain.collected = 0;
    brain.focus = -1;
    this.#owners[brain.slot] = undefined;
    this.#isLive[brain.slot] = false;
    // The slot's next brain is a new record, so a late call through the freed unit's `brain` reaches nothing live; it
    // counts starts on from this one's, so the freed brain's entries still on the wheel stay stale.
    const next = new Brain(brain.slot, this.#timers);

    next.starts.set(brain.starts);
    this.#brains[brain.slot] = next;
    this.#free.push(brain.slot);

    return true;
  }

  /** Whether a brain is the live one of its slot, not a freed unit's old record. */
  #isLiveBrain(brain: Brain): boolean {
    return this.#isLive[brain.slot] === true && this.#brains[brain.slot] === brain;
  }

  /**
   * Starts a timer (again): due `seconds` from now, rounded up to whole ticks; a held brain's keeps the rounded
   * seconds until the brain is released.
   */
  start(unit: G['bearer'], timer: TimerId, seconds: number): void {
    if (!(seconds >= 0) || !Number.isFinite(seconds)) {
      throw new RangeError(`A timer runs a finite number of seconds from 0; got ${seconds}.`);
    }

    const brain = this.#own(unit, timer);

    if (brain === undefined) {
      return;
    }

    brain.collected &= ~(1 << timer);
    this.#stop(brain, timer);

    if (brain.holds === 0) {
      this.#schedule(brain, timer, seconds);
    } else {
      const { dt } = this.#clock;

      brain.left[timer] = stepsUntil(seconds, dt) * dt;
      brain.stamps[timer] = this.#stamp++;
    }
  }

  /** Stops a timer; false when it was not running. */
  cancel(unit: G['bearer'], timer: TimerId): boolean {
    const brain = this.#own(unit, timer);

    if (brain === undefined) {
      return false;
    }

    const bit = 1 << timer;

    const wasRunning =
      (brain.collected & bit) !== 0 ||
      !Number.isNaN(brain.due[timer] ?? NONE) ||
      !Number.isNaN(brain.left[timer] ?? NONE);

    brain.collected &= ~bit;
    this.#stop(brain, timer);
    brain.left[timer] = NONE;

    return wasRunning;
  }

  /**
   * The seconds left on a timer (held or not): 0 for one collected and not yet taken; `undefined` when it is not
   * running.
   */
  remaining(unit: G['bearer'], timer: TimerId): number | undefined {
    const brain = this.#own(unit, timer);

    if (brain === undefined) {
      return undefined;
    }

    if ((brain.collected & (1 << timer)) !== 0) {
      return 0;
    }

    const due = brain.due[timer] ?? NONE;

    if (!Number.isNaN(due)) {
      return Math.max(0, due - this.#clock.tick) * this.#clock.dt;
    }

    const left = brain.left[timer] ?? NONE;

    return Number.isNaN(left) ? undefined : left;
  }

  /**
   * Sets or clears hold bits on a brain: while any is set its timers stop counting, and once none is they run on from
   * what they had left. Returns whether the brain is held now.
   */
  hold(unit: G['bearer'], change: { readonly bits: number; readonly isOn: boolean }): boolean {
    const brain = brainOf(unit.brain);

    if (!this.#isLiveBrain(brain)) {
      return false;
    }

    const was = brain.holds;

    brain.holds = change.isOn ? was | change.bits : was & ~change.bits;

    if (was === 0 && brain.holds !== 0) {
      this.#freeze(brain);
    } else if (was !== 0 && brain.holds === 0) {
      this.#thaw(brain);
    }

    return brain.holds !== 0;
  }

  /** The bits of the reasons holding a brain's timers; 0 for a freed brain. */
  holdsOf(unit: G['bearer']): number {
    const brain = brainOf(unit.brain);

    return this.#isLiveBrain(brain) ? brain.holds : 0;
  }

  /**
   * Sets the entity id a brain focuses (−1 for none); a freed brain keeps none. Returns whether it was written. Throws
   * for an id that is not an integer.
   */
  setFocus(unit: G['bearer'], focus: number): boolean {
    if (!Number.isInteger(focus)) {
      throw new RangeError(`A focus is an entity id, or −1 for none; got ${focus}.`);
    }

    const brain = brainOf(unit.brain);

    if (!this.#isLiveBrain(brain)) {
      return false;
    }

    brain.focus = focus;

    return true;
  }

  /**
   * Whether a timer `collect` handed out still stands, taking it: a start, a cancel or a hold since then drops it (a
   * held one fires again once let go).
   */
  take(unit: G['bearer'], timer: TimerId): boolean {
    const brain = brainOf(unit.brain);

    this.#checkTimer(timer);

    const bit = 1 << timer;

    if ((brain.collected & bit) === 0) {
      return false;
    }

    brain.collected &= ~bit;

    return true;
  }

  /**
   * Fires every timer due by the clock's tick, in due order, each once: `fire(unit, timer)`. With `keep`, each stays
   * collected until `take`. Returns how many. When `fire` throws, the timers due after it go back on the wheel for the
   * next tick's step, behind the timers already due then (a second step on this tick fires nothing).
   */
  step(fire: (unit: G['bearer'], timer: TimerId) => void, keep: boolean): number {
    const due = this.#due;
    const count = this.#wheel.collect(this.#clock.tick, due);
    let fired = 0;
    let i = 0;

    try {
      for (; i < count; i++) {
        const entry = due[i];

        if (entry !== undefined && this.#fireEntry(entry, fire, keep)) {
          fired += 1;
        }
      }
    } catch (error) {
      this.#requeue(i + 1, count);

      throw error;
    }

    return fired;
  }

  /** Fires one collected entry unless it is stale, marking it collected with `keep`; whether it fired. */
  #fireEntry(entry: number, fire: (unit: G['bearer'], timer: TimerId) => void, keep: boolean): boolean {
    const unit = this.#claim(entry);

    if (unit === undefined) {
      return false;
    }

    const timer = entry % MAX_TIMERS;

    if (keep) {
      const brain = brainOf(unit.brain);

      brain.collected |= 1 << timer;
      // Restamped as it is collected, so a hold before it is taken gives it back in the order it was collected.
      brain.stamps[timer] = this.#stamp++;
    }

    fire(unit, toId<'timers'>(timer));

    return true;
  }

  /**
   * Puts the collected entries from `from` on back on the wheel, unchanged, after a `fire` threw. The wheel has
   * collected the clock's tick, so they are clamped to the next one: the next tick's step fires them, behind the timers
   * already due on that tick, in their order, and a second step on this same tick fires nothing.
   */
  #requeue(from: number, count: number): void {
    const due = this.#due;

    for (let i = from; i < count; i++) {
      const entry = due[i];

      if (entry !== undefined) {
        this.#wheel.schedule(this.#clock.tick, entry);
      }
    }
  }

  /**
   * The brain whose timer is live now, its owner noted; `undefined` for a freed
   * brain (a late proc on a despawned unit), so the next unit given it inherits nothing. Throws for a timer the table
   * does not have.
   */
  #own(unit: G['bearer'], timer: TimerId): Brain | undefined {
    const brain = brainOf(unit.brain);

    this.#checkTimer(timer);

    if (!this.#isLiveBrain(brain)) {
      return undefined;
    }

    this.#owners[brain.slot] = unit;

    return brain;
  }

  /** Throws for a timer id that is not one of the table's: an integer from 0 below the count. */
  #checkTimer(timer: number): void {
    if (!(Number.isInteger(timer) && timer >= 0 && timer < this.#timers)) {
      throw new RangeError(`Timer ${timer} is not one of the system's ${this.#timers}.`);
    }
  }

  /**
   * The owner of a due entry, its timer cleared so it may start again; `undefined` for a stale entry: one whose timer
   * was stopped, held, or started again for a later tick since (a timer started again for the same tick leaves two
   * entries, and the second finds it cleared).
   */
  #claim(entry: number): G['bearer'] | undefined {
    const timer = entry % MAX_TIMERS;
    const rest = (entry - timer) / MAX_TIMERS;
    const slot = rest % SLOT_SPAN;
    const brain = this.#brains[slot];

    // Its timer was started again since (for this very tick, maybe): this entry is the old start's.
    if (brain === undefined || brain.starts[timer] !== (rest - slot) / SLOT_SPAN) {
      return undefined;
    }

    if (!((brain.due[timer] ?? NONE) <= this.#clock.tick)) {
      return undefined;
    }

    this.#stop(brain, timer);

    return this.#owners[slot];
  }

  /** Puts a timer on the wheel `seconds` from now. */
  #schedule(brain: Brain, timer: number, seconds: number): void {
    const { tick, dt } = this.#clock;
    const at = tick + stepsUntil(seconds, dt);
    const start = ((brain.starts[timer] ?? 0) + 1) % STARTS;

    brain.due[timer] = at;
    brain.starts[timer] = start;
    brain.stamps[timer] = this.#stamp++;
    this.#wheel.schedule(at, (start * SLOT_SPAN + brain.slot) * MAX_TIMERS + timer);
  }

  /** Takes a timer off the wheel: its entry goes stale. */
  #stop(brain: Brain, timer: number): void {
    brain.due[timer] = NONE;
  }

  /**
   * A brain is held: each running timer keeps what it has left, off the wheel, and a collected one not yet taken
   * waits with nothing left, ahead of the others (in the order it was collected).
   */
  #freeze(brain: Brain): void {
    const { tick, dt } = this.#clock;

    for (let timer = 0; timer < this.#timers; timer++) {
      const due = brain.due[timer] ?? NONE;

      if ((brain.collected & (1 << timer)) !== 0) {
        brain.left[timer] = 0;
        brain.stamps[timer] = (brain.stamps[timer] ?? 0) - COLLECTED_FIRST;
      } else if (!Number.isNaN(due)) {
        brain.left[timer] = Math.max(0, due - tick) * dt;
        this.#stop(brain, timer);
      }
    }

    brain.collected = 0;
  }

  /**
   * A brain is released: each held timer goes back on the wheel with what it had left, in the order they were started
   * (a collected one in the order it was collected), so timers due on one tick fire as they would have unheld.
   */
  #thaw(brain: Brain): void {
    const order = this.#order;
    let count = 0;

    for (let timer = 0; timer < this.#timers; timer++) {
      if (!Number.isNaN(brain.left[timer] ?? NONE)) {
        count = insertByStamp(order, count, timer, brain.stamps);
      }
    }

    for (let i = 0; i < count; i++) {
      const timer = order[i] ?? 0;
      const left = brain.left[timer] ?? NONE;

      brain.left[timer] = NONE;
      this.#schedule(brain, timer, left);
    }
  }
}

/** Inserts a timer into the first `count` of `order`, kept in ascending stamp order; the new count. */
const insertByStamp = (order: Uint8Array, count: number, timer: number, stamps: Float64Array): number => {
  const stamp = stamps[timer] ?? 0;
  let at = count;

  while (at > 0 && (stamps[order[at - 1] ?? 0] ?? 0) > stamp) {
    order[at] = order[at - 1] ?? 0;
    at -= 1;
  }

  order[at] = timer;

  return count + 1;
};

/** A slot with no brain: the free list prevents it. */
const missingSlot = (slot: number): never => {
  throw new Error(`Brain slot ${slot} has no brain.`);
};
