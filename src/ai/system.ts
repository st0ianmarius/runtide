import type { SpellClock, SpellId, SpellSystem } from '../spells/index.ts';
import type { AiTypes, TimerId } from './ai-types.ts';
import { brainOf, type BrainState } from './brain.ts';
import { Picker, type PickOptions } from './picker.ts';
import { createAiProcKinds } from './proc-kinds.ts';
import type { AiProcKinds } from './procs.ts';
import { Scheduler } from './scheduler.ts';
import type { TimerTable } from './timers.ts';

/** The hold bit of the game's own holds (`ai.hold`); each interrupt that holds has its own above it. */
const GAME_HOLD = 1;

/** What an AI system is built from. */
export interface AiSystemOptions<G extends AiTypes> {
  /** The spell system its picks check against (`spells.check`) and whose interrupts hold its timers. */
  readonly spells: SpellSystem<G>;

  /** The fixed-step clock its timers count on (the spell system's). */
  readonly clock: SpellClock;

  /** The game's timers (`defineTimers`). */
  readonly timers: TimerTable<G['timerName']>;

  /**
   * The interrupts that hold a brain's timers while its unit holds them (a stun or a freeze holds a
   * creature's timers as it pauses its cast), raised through `ai.interrupt`. None when absent.
   */
  readonly heldBy?: readonly G['interrupt'][];
}

/**
 * An AI system: the toolkit every brain is built from, and nothing more. Named timers on a timing wheel
 * (TrinityCore's `EventMap`), one weighted anti-repeat spell picker that reads each spell's own cast rules, a focus
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
   * The game's own hold on a brain's timers (stages such as an intro or a blink hold them): while on, they
   * stop counting; returns whether the brain is held now, by this or an interrupt.
   */
  readonly hold: (unit: G['bearer'], isOn: boolean) => boolean;

  /**
   * An interrupt on a unit starts or ends (a unit system calls it with its states' interrupts): one the system is
   * `heldBy` holds the unit's timers while on. Returns whether the brain is held now.
   */
  readonly interrupt: (unit: G['bearer'], reason: G['interrupt'], isOn: boolean) => boolean;

  /** Picks a spell from a pool, weighted, the last pick left out while another fits; `undefined` for none. */
  readonly pick: (caster: G['bearer'], pool: readonly SpellId[], options: PickOptions<G>) => SpellId | undefined;

  /** The first spell of an ordered list that would start now (a reaction); `undefined` for none. */
  readonly first: (
    caster: G['bearer'],
    spells: readonly SpellId[],
    options?: Pick<PickOptions<G>, 'input' | 'allows'>,
  ) => SpellId | undefined;

  /** The entity id a unit focuses (a tether's target, a sticky target); −1 for none. */
  readonly focusOf: (unit: G['bearer']) => number;

  /** Sets the entity id a unit focuses; −1 clears it. */
  readonly setFocus: (unit: G['bearer'], focus: number) => void;
}

/** Creates the AI system: `createAiSystem({ spells, clock, timers: TIMERS, heldBy: ['stun', 'freeze'] })`. */
export const createAiSystem = <G extends AiTypes>(options: AiSystemOptions<G>): AiSystem<G> => {
  const { spells, timers } = options;
  const scheduler = new Scheduler<G>(options.clock, timers.names.length);
  const picker = new Picker<G>(spells);
  const heldBy = spells.interruptMask(options.heldBy ?? []);
  // Each holding interrupt's bit, looked up once: a stun edge reads one map, where a mask would build an array.
  const holdBits = new Map((options.heldBy ?? []).map((reason) => [reason, spells.interruptMask([reason])]));

  const system: AiSystem<G> = {
    timers,

    brains: {
      get live() {
        return scheduler.live;
      },

      get created() {
        return scheduler.created;
      },
    },

    procKinds: createAiProcKinds({ timers, scheduler }),
    createBrain: () => scheduler.create(),
    release: (unit) => scheduler.release(unit),

    start: (unit, timer, seconds) => {
      scheduler.start(unit, timer, seconds);
    },

    cancel: (unit, timer) => scheduler.cancel(unit, timer),
    remaining: (unit, timer) => scheduler.remaining(unit, timer),
    step: (fire) => scheduler.step(fire),
    hold: (unit, isOn) => scheduler.hold(unit, { bits: GAME_HOLD, isOn }),

    interrupt: (unit, reason, isOn) =>
      scheduler.hold(unit, { bits: holdBits.get(reason) ?? spells.interruptMask([reason]) & heldBy, isOn }),

    pick: (caster, pool, pick) => picker.pick(caster, pool, pick),
    first: (caster, list, first) => picker.first(caster, list, first),
    focusOf: (unit) => unit.brain.focus,

    setFocus: (unit, focus) => {
      brainOf(unit.brain).focus = focus;
    },
  };

  return Object.freeze(system);
};
