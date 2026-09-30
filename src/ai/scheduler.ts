import { toId } from '../core/ids.ts';
import { createTimingWheel, stepsUntil, type TimingWheel } from '../core/index.ts';
import type { SpellClock } from '../spells/index.ts';
import type { AiTypes, TimerId } from './ai-types.ts';
import { Brain, brainOf } from './brain.ts';
import { MAX_TIMERS } from './timers.ts';

/** The most brains one system holds at once: each is a slot of a wheel entry. */
const SLOT_SPAN = 2 ** 20;

/** Generations wrap here, so an entry stays a safe integer. */
const GENERATION_SPAN = 2 ** 20;

/** No timer: the entry's timer field. */
const NONE = Number.NaN;

/**
 * The timers of every brain of one AI system (§I.7.1 F17, TrinityCore's `EventMap`): each running timer is one entry
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

  constructor(clock: SpellClock, timers: number) {
    this.#clock = clock;
    this.#timers = timers;
    this.#wheel = createTimingWheel({ start: clock.tick });
  }

  /** How many brains are live. */
  get live(): number {
    return this.#brains.length - this.#free.length;
  }

  /** How many brain records were ever made. */
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

    if (this.#isLive[brain.slot] !== true) {
      return false;
    }

    for (let timer = 0; timer < this.#timers; timer++) {
      this.#stop(brain, timer);
      brain.left[timer] = NONE;
    }

    brain.holds = 0;
    brain.focus = -1;
    brain.lastPick = -1;
    this.#owners[brain.slot] = undefined;
    this.#isLive[brain.slot] = false;
    this.#free.push(brain.slot);

    return true;
  }

  /** Starts a timer (again): due `seconds` from now, or when its brain is released if it is held. */
  start(unit: G['bearer'], timer: TimerId, seconds: number): void {
    if (!(seconds >= 0) || !Number.isFinite(seconds)) {
      throw new RangeError(`A timer runs a finite number of seconds from 0; got ${seconds}.`);
    }

    const brain = this.#own(unit, timer);

    this.#stop(brain, timer);

    if (brain.holds === 0) {
      this.#schedule(brain, timer, seconds);
    } else {
      brain.left[timer] = seconds;
    }
  }

  /** Stops a timer; false when it was not running. */
  cancel(unit: G['bearer'], timer: TimerId): boolean {
    const brain = this.#own(unit, timer);
    const wasRunning = !Number.isNaN(brain.due[timer] ?? NONE) || !Number.isNaN(brain.left[timer] ?? NONE);

    this.#stop(brain, timer);
    brain.left[timer] = NONE;

    return wasRunning;
  }

  /** The seconds left on a timer (held or not); `undefined` when it is not running. */
  remaining(unit: G['bearer'], timer: TimerId): number | undefined {
    const brain = this.#own(unit, timer);
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
    const was = brain.holds;

    brain.holds = change.isOn ? was | change.bits : was & ~change.bits;

    if (was === 0 && brain.holds !== 0) {
      this.#freeze(brain);
    } else if (was !== 0 && brain.holds === 0) {
      this.#thaw(brain);
    }

    return brain.holds !== 0;
  }

  /** Fires every timer due by the clock's tick, in due order, each once: `fire(unit, timer)`. Returns how many. */
  step(fire: (unit: G['bearer'], timer: TimerId) => void): number {
    const due = this.#due;
    const count = this.#wheel.collect(this.#clock.tick, due);
    let fired = 0;

    for (let i = 0; i < count; i++) {
      const entry = due[i];
      const unit = entry === undefined ? undefined : this.#claim(entry);

      if (unit !== undefined && entry !== undefined) {
        fire(unit, toId<'timers'>(entry % MAX_TIMERS));
        fired += 1;
      }
    }

    return fired;
  }

  /** The brain whose timer is live now, its owner noted; throws for a timer the table does not have. */
  #own(unit: G['bearer'], timer: TimerId): Brain {
    const brain = brainOf(unit.brain);

    if (!(timer >= 0 && timer < this.#timers)) {
      throw new RangeError(`Timer ${timer} is not one of the system's ${this.#timers}.`);
    }

    this.#owners[brain.slot] = unit;

    return brain;
  }

  /** The owner of a due entry, its timer cleared so it may start again; `undefined` for a stale entry. */
  #claim(entry: number): G['bearer'] | undefined {
    const timer = entry % MAX_TIMERS;
    const slot = Math.floor(entry / MAX_TIMERS) % SLOT_SPAN;
    const generation = Math.floor(entry / (MAX_TIMERS * SLOT_SPAN));
    const brain = this.#brains[slot];

    if (brain === undefined || (brain.generations[timer] ?? 0) % GENERATION_SPAN !== generation) {
      return undefined;
    }

    this.#stop(brain, timer);

    return this.#owners[slot];
  }

  /** Puts a timer on the wheel `seconds` from now. */
  #schedule(brain: Brain, timer: number, seconds: number): void {
    const { tick, dt } = this.#clock;
    const at = tick + stepsUntil(seconds, dt);
    const generation = (brain.generations[timer] ?? 0) % GENERATION_SPAN;

    brain.due[timer] = at;
    this.#wheel.schedule(at, (generation * SLOT_SPAN + brain.slot) * MAX_TIMERS + timer);
  }

  /** Takes a timer off the wheel: its entry goes stale. */
  #stop(brain: Brain, timer: number): void {
    brain.due[timer] = NONE;
    brain.generations[timer] = (brain.generations[timer] ?? 0) + 1;
  }

  /** A brain is held: each running timer keeps what it has left, off the wheel. */
  #freeze(brain: Brain): void {
    const { tick, dt } = this.#clock;

    for (let timer = 0; timer < this.#timers; timer++) {
      const due = brain.due[timer] ?? NONE;

      if (!Number.isNaN(due)) {
        brain.left[timer] = Math.max(0, due - tick) * dt;
        this.#stop(brain, timer);
      }
    }
  }

  /** A brain is released: each held timer goes back on the wheel with what it had left. */
  #thaw(brain: Brain): void {
    for (let timer = 0; timer < this.#timers; timer++) {
      const left = brain.left[timer] ?? NONE;

      if (!Number.isNaN(left)) {
        brain.left[timer] = NONE;
        this.#schedule(brain, timer, left);
      }
    }
  }
}

/** A slot with no brain: the free list prevents it. */
const missingSlot = (slot: number): never => {
  throw new Error(`Brain slot ${slot} has no brain.`);
};
