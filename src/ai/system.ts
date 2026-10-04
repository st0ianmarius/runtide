import type { SpellClock, SpellId, SpellSystem } from '../spells/index.ts';
import type { AiTypes, TimerId } from './ai-types.ts';
import type { BrainState } from './brain.ts';
import { Picker, type PickOptions } from './picker.ts';
import { createAiProcKinds } from './proc-kinds.ts';
import type { AiProcKinds } from './procs.ts';
import { Scheduler } from './scheduler.ts';
import type { TimerTable } from './timers.ts';

/**
 * The hold reason every AI system has, beside the game's: the unit system holds a dead unit's brain by it, so its
 * timers stop counting until a revive lets go of them.
 */
export const DEAD_HOLD = 'dead';

/** The most hold reasons a system takes: each is one bit of a brain's holds. */
const MAX_HOLDS = 31;

/**
 * The clock ticks the timers were last stepped on each way, firing (`step`) and collecting (`collect`): both read one
 * wheel, so a tick one took leaves the other nothing due.
 */
class StepTicks {
  /** The tick `step` last ran on; −1 before it ever ran. */
  stepped = -1;

  /** The tick `collect` last ran on; −1 before it ever ran. */
  collected = -1;

  /** Notes a step on `tick`, collecting with `keep`; throws when the other way already took that tick. */
  claim(tick: number, keep: boolean): void {
    if (keep ? this.stepped === tick : this.collected === tick) {
      const [ran, now] = keep ? ['ai.step', 'ai.collect'] : ['ai.collect (scripts.collect)', 'ai.step'];

      throw new Error(
        `${now} on tick ${tick}, which ${ran} already took: a game steps the AI timers one way, ai.step(fire) or ` +
          'scripts.collect(), once a tick.'
      );
    }

    if (keep) {
      this.collected = tick;
    } else {
      this.stepped = tick;
    }
  }
}

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
   * interrupts its creatures wait out (a freeze, which the unit system passes on). None when absent; at most 30, each
   * once. `DEAD_HOLD` is every system's own and may not be listed: a unit state named after it would let go of a dead
   * unit's brain.
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

  /** The fixed-step clock its timers count on (the spell system's). */
  readonly clock: SpellClock;

  /**
   * The clock tick `step` last ran on, −1 before it ever ran: a timer system that reads the same wheel (the script
   * system's `collect`) checks it to refuse a tick `step` already took.
   */
  readonly steppedTick: number;

  /** The clock tick `collect` last ran on, −1 before it ever ran. */
  readonly collectedTick: number;

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

  /**
   * Starts (or restarts) a timer, due `seconds` from now, rounded up to whole ticks; a held brain's waits until it is
   * released. Throws for a timer id that is not an integer of the table.
   */
  readonly start: (unit: G['bearer'], timer: TimerId, seconds: number) => void;

  /** Stops a timer; false when it was not running. */
  readonly cancel: (unit: G['bearer'], timer: TimerId) => boolean;

  /**
   * The seconds left on a timer, held or not, rounded up to whole ticks: 0 for one `collect` handed out and not yet
   * taken; `undefined` when it is not running.
   */
  readonly remaining: (unit: G['bearer'], timer: TimerId) => number | undefined;

  /**
   * Fires every timer due by the clock's tick, in due order (timers due on one tick in the order they were started),
   * each once and stopped first, so `fire` may start it again; returns how many fired. The host calls it once a tick,
   * after stepping the clock, with the same function each time; a second call on the same tick fires nothing. A game
   * whose units run scripts calls `scripts.collect()` in its place, never both: `step` throws on a tick `collect` (the
   * script system's) already took, as the timers it would fire were handed to the scripted units' steps.
   */
  readonly step: (fire: (unit: G['bearer'], timer: TimerId) => void) => number;

  /**
   * Collects every timer due by the clock's tick as `step` does, for a system that delivers them later in each unit's
   * own step (the script system): each stays collected until `take`, and a start, a cancel or a hold of it in between
   * drops it (a held one fires again once let go). Returns how many. Throws on a tick `step` already took.
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

  /**
   * Whether a unit's brain is held: by any reason, or by `reason` when given (false for one the system was not given,
   * and for a freed brain). A game's own per-unit logic (a script's `tick`) runs on while its timers are held, and asks
   * this to wait out an intro or a freeze too.
   */
  readonly isHeld: (unit: G['bearer'], reason?: string) => boolean;

  /** Picks a spell from a pool, weighted; `undefined` for none. */
  readonly pick: (caster: G['bearer'], pool: readonly SpellId[], options: PickOptions<G>) => SpellId | undefined;

  /** The first spell of an ordered list that would start now (a reaction); `undefined` for none. */
  readonly first: (
    caster: G['bearer'],
    spells: readonly SpellId[],
    options?: Pick<PickOptions<G>, 'input' | 'inputOf' | 'allows'>
  ) => SpellId | undefined;

  /**
   * Folds a unit's brain into a running state digest (`DIGEST_START` to begin): per timer the ticks until it is due
   * (NaN when it is not on the wheel) and the seconds a held one has left (NaN for none), then the bits of its timers
   * collected and not yet taken, its holds and its focus; −1 alone for a unit with no live brain. The script records a
   * scripted unit's step reads are game-owned objects the game digests itself. Allocation-free.
   */
  readonly digest: (unit: G['bearer'], hash: number) => number;

  /** The entity id a unit focuses (a tether's target, a sticky target); −1 for none. */
  readonly focusOf: (unit: G['bearer']) => number;

  /**
   * Sets the entity id a unit focuses; −1 clears it. A freed brain keeps none (a late call on a despawned unit does
   * nothing); throws for an id that is not an integer.
   */
  readonly setFocus: (unit: G['bearer'], focus: number) => void;
}

/** Creates the AI system: `createAiSystem({ spells, clock, timers: TIMERS, holds: ['intro', 'freeze'] })`. */
export const createAiSystem = <G extends AiTypes>(options: AiSystemOptions<G>): AiSystem<G> => {
  const { spells, timers } = options;
  const scheduler = new Scheduler<G>(options.clock, timers.names.length);
  const ticks = new StepTicks();
  const picker = new Picker<G>(spells);
  const given = options.holds ?? [];

  if (given.includes(DEAD_HOLD)) {
    throw new RangeError(
      `The hold reason '${DEAD_HOLD}' is the system's own (DEAD_HOLD); name the game's another way.`
    );
  }

  const holds = [...given, DEAD_HOLD];

  if (holds.length > MAX_HOLDS || new Set(holds).size !== holds.length) {
    throw new RangeError(`An AI system takes at most ${MAX_HOLDS - 1} hold reasons, each once.`);
  }

  // Each reason's bit, looked up once: a freeze edge reads one map.
  const holdBits = new Map(holds.map((reason, index) => [reason, 2 ** index]));

  const system: AiSystem<G> = {
    timers,
    clock: options.clock,

    get steppedTick() {
      return ticks.stepped;
    },

    get collectedTick() {
      return ticks.collected;
    },

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
    step: (fire) => {
      ticks.claim(options.clock.tick, false);

      return scheduler.step(fire, false);
    },

    collect: (mark) => {
      ticks.claim(options.clock.tick, true);

      return scheduler.step(mark, true);
    },

    take: (unit, timer) => scheduler.take(unit, timer),
    hold: (unit, reason, isOn) => scheduler.hold(unit, { bits: holdBits.get(reason) ?? 0, isOn }),

    isHeld: (unit, reason) => {
      const bits = scheduler.holdsOf(unit);

      return reason === undefined ? bits !== 0 : (bits & (holdBits.get(reason) ?? 0)) !== 0;
    },

    pick: (caster, pool, pick) => picker.pick(caster, pool, pick),
    first: (caster, list, first) => picker.first(caster, list, first),
    digest: (unit, hash) => scheduler.digest(unit, hash),
    focusOf: (unit) => unit.brain.focus,

    setFocus: (unit, focus) => {
      scheduler.setFocus(unit, focus);
    }
  };

  return Object.freeze(system);
};
