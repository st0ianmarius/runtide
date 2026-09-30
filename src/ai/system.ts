import type { SpellClock, SpellId, SpellSystem } from '../spells/index.ts';
import type { AiTypes, TimerId } from './ai-types.ts';
import type { BrainState } from './brain.ts';
import { Picker, type PickOptions } from './picker.ts';
import { createAiProcKinds } from './proc-kinds.ts';
import type { AiProcKinds } from './procs.ts';
import { Scheduler } from './scheduler.ts';
import type { TimerTable } from './timers.ts';

/** The most hold reasons a system takes: each is one bit of a brain's holds. */
const MAX_HOLDS = 31;

/** What an AI system is built from. */
export interface AiSystemOptions<G extends AiTypes> {
  /** The spell system its picks check against (`spells.check`). */
  readonly spells: SpellSystem<G>;

  /** The fixed-step clock its timers count on (the spell system's). */
  readonly clock: SpellClock;

  /** The game's timers (`defineTimers`). */
  readonly timers: TimerTable<G['timerName']>;

  /**
   * The reasons that hold a brain's timers (`ai.hold`), the game's own: an intro or a blink, and the unit states'
   * interrupts its creatures wait out (a freeze, which the unit system passes on). None when absent; at most 31.
   */
  readonly holds?: readonly string[];
}

/**
 * An AI system: the toolkit every brain is built from, and nothing more. Named timers on a timing wheel
 * (TrinityCore's `EventMap`), one weighted spell picker that reads each spell's own cast rules, a focus
 * the procs may set. What a brain decides with them (its reactions, its budget, its target policy, its movement) is
 * the game's.
 */
export interface AiSystem<G extends AiTypes> {
  /** The game's timers. */
  readonly timers: TimerTable<G['timerName']>;

  /** How many brains are live, and how many records were made: a steady state makes no new ones. */
  readonly brains: {
    /** Brains live. */
    readonly live: number;

    /** Records ever made. */
    readonly created: number;
  };

  /** The proc kinds `setTimer`, `cancelTimer` and `setFocus`: `createProcRegistry({ ...CORE_PROCS, ...ai.procKinds })`. */
  readonly procKinds: AiProcKinds<G>;

  /** A new brain, for a unit that thinks (`AiBearer.brain`); from a freed record when there is one. */
  readonly createBrain: () => BrainState;

  /** Frees a unit's brain as it leaves (its timers stop, its record is reused); false when already freed. */
  readonly release: (unit: G['bearer']) => boolean;

  /** Starts (or restarts) a timer, due `seconds` from now; a held brain's waits until it is released. */
  readonly start: (unit: G['bearer'], timer: TimerId, seconds: number) => void;

  /** Stops a timer; false when it was not running. */
  readonly cancel: (unit: G['bearer'], timer: TimerId) => boolean;

  /** The seconds left on a timer, held or not; `undefined` when it is not running. */
  readonly remaining: (unit: G['bearer'], timer: TimerId) => number | undefined;

  /**
   * Fires every timer due by the clock's tick, in due order (timers due on one tick in the order they were started),
   * each once and stopped first, so `fire` may start it again; returns how many fired. The host calls it once a tick,
   * with the same function each time.
   */
  readonly step: (fire: (unit: G['bearer'], timer: TimerId) => void) => number;

  /**
   * Collects every timer due by the clock's tick as `step` does, for a system that delivers them later in each unit's
   * own step (the script system): each stays collected until `take`, and a start, a cancel or a hold of it in between
   * drops it (a held one fires again once let go). Returns how many.
   */
  readonly collect: (mark: (unit: G['bearer'], timer: TimerId) => void) => number;

  /** Whether a timer `collect` handed out still stands, taking it. */
  readonly take: (unit: G['bearer'], timer: TimerId) => boolean;

  /**
   * Holds (or lets go of) a brain's timers for one reason: while any of the system's `holds` is on, they stop counting.
   * A reason the system was not given does nothing (a unit state's interrupt its creatures do not wait out). Returns
   * whether the brain is held now.
   */
  readonly hold: (unit: G['bearer'], reason: string, isOn: boolean) => boolean;

  /** Picks a spell from a pool, weighted; `undefined` for none. */
  readonly pick: (caster: G['bearer'], pool: readonly SpellId[], options: PickOptions<G>) => SpellId | undefined;

  /** The first spell of an ordered list that would start now (a reaction); `undefined` for none. */
  readonly first: (
    caster: G['bearer'],
    spells: readonly SpellId[],
    options?: Pick<PickOptions<G>, 'input' | 'allows'>
  ) => SpellId | undefined;

  /** The entity id a unit focuses (a tether's target, a sticky target); −1 for none. */
  readonly focusOf: (unit: G['bearer']) => number;

  /** Sets the entity id a unit focuses; −1 clears it. */
  readonly setFocus: (unit: G['bearer'], focus: number) => void;
}

/** Creates the AI system: `createAiSystem({ spells, clock, timers: TIMERS, holds: ['intro', 'freeze'] })`. */
export const createAiSystem = <G extends AiTypes>(options: AiSystemOptions<G>): AiSystem<G> => {
  const { spells, timers } = options;
  const scheduler = new Scheduler<G>(options.clock, timers.names.length);
  const picker = new Picker<G>(spells);
  const holds = options.holds ?? [];

  if (holds.length > MAX_HOLDS || new Set(holds).size !== holds.length) {
    throw new RangeError(`An AI system takes at most ${MAX_HOLDS} hold reasons, each once.`);
  }

  // Each reason's bit, looked up once: a freeze edge reads one map.
  const holdBits = new Map(holds.map((reason, index) => [reason, 2 ** index]));

  const system: AiSystem<G> = {
    timers,

    brains: {
      get live() {
        return scheduler.live;
      },

      get created() {
        return scheduler.created;
      }
    },

    procKinds: createAiProcKinds({ timers, scheduler }),
    createBrain: () => scheduler.create(),
    release: (unit) => scheduler.release(unit),

    start: (unit, timer, seconds) => {
      scheduler.start(unit, timer, seconds);
    },

    cancel: (unit, timer) => scheduler.cancel(unit, timer),
    remaining: (unit, timer) => scheduler.remaining(unit, timer),
    step: (fire) => scheduler.step(fire, false),
    collect: (mark) => scheduler.step(mark, true),
    take: (unit, timer) => scheduler.take(unit, timer),
    hold: (unit, reason, isOn) => scheduler.hold(unit, { bits: holdBits.get(reason) ?? 0, isOn }),

    pick: (caster, pool, pick) => picker.pick(caster, pool, pick),
    first: (caster, list, first) => picker.first(caster, list, first),
    focusOf: (unit) => unit.brain.focus,

    setFocus: (unit, focus) => {
      scheduler.setFocus(unit, focus);
    }
  };

  return Object.freeze(system);
};
