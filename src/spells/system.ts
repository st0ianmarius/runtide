import type { TickSlotId } from '../core/index.ts';
import type { StatId } from '../modifiers/index.ts';
import { autoClockOf, type ClockScale, rescaleClocks, stepAutoClocks } from './auto.ts';
import { engineOf, gameActivationsOf } from './build-engine.ts';
import { fireCastCue } from './cast-cue.ts';
import {
  type CastOptions,
  type CastRefusal,
  type CastReport,
  type CastRequest,
  MutableRequest,
  NO_OPTIONS,
  Report,
} from './cast-request.ts';
import { CasterRecord, type CasterState, recordOf } from './caster.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { SpellEngine } from './engine.ts';
import { hitCast } from './hit.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import { createSpellProcKinds } from './proc-kinds.ts';
import type { SpellProcKinds } from './procs.ts';
import { checkCast, startCast } from './runner.ts';
import type { CastOutcome, SpellContext, SpellHit } from './spell-def.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import {
  cancelCast,
  cancelCaster,
  finishCast,
  interruptCaster,
  isCasting,
  MANUAL_PAUSE,
  setPause,
  stepCaster,
} from './stepper.ts';
import type { SpellSystemOptions } from './system-options.ts';
import { type CastView, viewCast } from './view.ts';

/**
 * A spell system (§I.6): the runner over one game's spells, for any caster. It starts casts in the cast order, runs
 * their hooks' procs credited to them, raises spell events and fires spell cues, and holds each spell's cast aura on
 * its caster while it casts.
 */
export interface SpellSystem<G extends SpellTypes> {
  /** The game's spells. */
  readonly registry: SpellRegistry<G>;

  /** How many cast records the pool has made, and how many are live: a steady state makes no new ones. */
  readonly pool: {
    /** Records ever made. */
    readonly created: number;

    /** Records live now (running, or ended and still held). */
    readonly live: number;
  };

  /** The proc kinds `castSpell` and `after`: `createProcRegistry({ ...CORE_PROCS, ...spells.procKinds })`. */
  readonly procKinds: SpellProcKinds<G>;

  /** The game's own activation kinds (and core kinds it replaced), in registry order, for the escape report. */
  readonly gameActivations: readonly string[];

  /** How many delayed proc lists wait to land, and how many records the pool has made. */
  readonly delayed: {
    /** Lists waiting, over every slot. */
    readonly pending: number;

    /** Records ever made: a steady state makes no new ones. */
    readonly created: number;
  };

  /** A new caster state, for a unit that casts (`SpellCaster.casts`). */
  readonly createCasterState: () => CasterState;

  /**
   * Starts a cast (§II.3.1): the gates (the host's `canAct`, the activation kind's), the stats, `canCast`, the target,
   * then `begin`, and the release at once for a spell with no windup. Returns the system's reused report.
   */
  readonly cast: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => CastReport;

  /**
   * Whether a cast would start (§I.7.1 F16), asked without starting it: the cast order up to `begin` (the gates, the
   * stats, `canCast`, the target and its reach). The refusal, or `undefined` when it would start. A picker reads it.
   */
  readonly check: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => CastRefusal | undefined;

  /** A delivery of a cast caught units: `onHit` with all of them, its cue and event; how many procs went off. */
  readonly hit: (cast: CastHandle, hit: SpellHit<G>) => number;

  /** A live cast's context (running, or ended and still held by its delayed procs); `undefined` when stale. */
  readonly get: (cast: CastHandle) => SpellContext<G> | undefined;

  /** Whether a cast is still in a stage (windup, channel or recover). */
  readonly isRunning: (cast: CastHandle) => boolean;

  /** Whether a caster runs any cast, or a cast of one spell. */
  readonly isCasting: (caster: G['bearer'], spell?: SpellId) => boolean;

  /**
   * Writes a caster's running casts into `out` from index 0, in the order they started, and returns how many. `out`
   * keeps its storage; entries past the count are left as they were.
   */
  readonly castsOf: (caster: G['bearer'], out: CastHandle[]) => number;

  /**
   * Steps every cast a caster runs by one step of the clock, in the order they started (§II.3.3): windups count down,
   * track and release, channels beat, recoveries end. The host calls it for each caster in its own order; a paused
   * cast does not count down.
   */
  readonly step: (caster: G['bearer']) => void;

  /**
   * Steps a caster's `auto` clocks by one step (§II.6 S2), in registry order: each counts down whether its spell is
   * owned or not, and one that ran out casts its spell when the caster owns it (`host.owns`); the clock is then set to
   * the interval read at the cast, or to the activation's retry, as the outcome's cost says (`onRefused`,
   * `onNoTarget`, `onMiss`).
   */
  readonly stepAuto: (caster: G['bearer']) => void;

  /** The seconds left on a caster's `auto` clock for a spell; 0 for one that is not `auto`. */
  readonly autoClock: (caster: G['bearer'], spell: SpellId) => number;

  /**
   * Lands every delayed list of a tick slot (the first when absent) due by the clock's tick, in the order they were
   * scheduled, each for its origin as its cast's procs; returns how many landed. The host calls it in its own loop.
   */
  readonly stepDelayed: (slot?: TickSlotId) => number;

  /**
   * Withdraws every delayed list a unit owns that has not landed (§II.6 P3 `despawnOwned`: an enraged elite's pending
   * volleys): those its casts scheduled, even casts that ended, and those scheduled for it outside a cast. How many.
   */
  readonly withdrawDelayed: (owner: G['bearer']) => number;

  /** Pauses a running cast: its stage stops counting until `resume`; false for a stale or ended cast. */
  readonly pause: (cast: CastHandle) => boolean;

  /** Resumes a cast `pause` paused (an interrupt's own pause stays until the interrupt ends). */
  readonly resume: (cast: CastHandle) => boolean;

  /** Cancels a running cast: `onCancel`, `onEnd` and the end event, with no recovery; false for a stale or ended one. */
  readonly cancel: (cast: CastHandle) => boolean;

  /**
   * Ends a running cast's payload now with an outcome (a charge into a wall ends `blocked`, a lost tether `broken`):
   * no release for a windup, the channel stops, and its recovery follows; false when there is no payload to end.
   */
  readonly finish: (cast: CastHandle, outcome: Exclude<CastOutcome, 'cancelled'>) => boolean;

  /**
   * An interrupt hits a caster (§I.7.1 F16: a stun, a freeze): the caster holds it until `endInterrupt`, and each
   * running cast answers it as its timeline says, pausing until it ends or cancelling; returns how many answered. A
   * unit system raises its states' interrupts itself (`units.syncStates`).
   */
  readonly interrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /** An interrupt on a caster ends: the casts it paused count down again (unless something else pauses them). */
  readonly endInterrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /**
   * Whether a caster holds an interrupt now (between `interrupt` and `endInterrupt`); false for one the game did not
   * declare (`interrupts`) and no timeline names. A cast started while it holds does not answer it.
   */
  readonly isInterrupted: (caster: G['bearer'], reason: G['interrupt']) => boolean;

  /**
   * The bits of a list of interrupts, for a system that checks them often (`heldInterrupts`): an area trigger's
   * `pausedBy`, resolved at load. Throws for one the game did not declare (`interrupts`) and no timeline names.
   */
  readonly interruptMask: (reasons: readonly G['interrupt'][]) => number;

  /** The bits of the interrupts a caster holds now, to test against an `interruptMask`. */
  readonly heldInterrupts: (caster: G['bearer']) => number;

  /** Cancels every cast a caster runs (§I.7.1 F16: its death), in the order they started; how many. */
  readonly cancelAll: (caster: G['bearer']) => number;

  /** The cast whose procs are running now (a hook's, a delayed list's), which what they spawn belongs to; or none. */
  readonly current: CastHandle;

  /**
   * Keeps a cast's record alive after it ends (§II.6 S6: its area triggers and summons live on), until as many
   * `release` calls as holds; false for a stale handle.
   */
  readonly hold: (cast: CastHandle) => boolean;

  /** Lets go of one hold; an ended cast nothing holds goes back to the pool. */
  readonly release: (cast: CastHandle) => void;

  /**
   * Makes a live cast the current one while another system runs its procs as that cast's (an area trigger's hooks),
   * and returns the one it replaced, which `leave` restores.
   */
  readonly enter: (cast: CastHandle) => CastHandle;

  /** Restores the current cast `enter` replaced. */
  readonly leave: (previous: CastHandle) => void;

  /**
   * A spell's share of an outgoing multiplier stat (§II.3.13: `SpellDef.scaling`), or `undefined` for a share of 1:
   * what the damage host's `shareOf` answers with (`shareOf: spells.shareOf`).
   */
  readonly shareOf: (spell: SpellId, stat: StatId) => number | undefined;

  /**
   * Rescales a caster's clocks (§II.6 A13, §I.7.1 F15): its `auto` clocks still counting in scope (a spell tag, or
   * every one), and with `isPendingOnly: false` its running casts' stage time left. An aura system's host passes its
   * rescales here: `rescaleClocks: (unit, rescale) => spells.rescaleClocks(unit, rescale)`. Returns how many rescaled.
   */
  readonly rescaleClocks: (caster: G['bearer'], rescale: ClockScale) => number;

  /** A running cast as the wire carries it (§II.6 C10): its spell, stage, stage end stamp and credit. */
  readonly viewOf: (cast: CastHandle) => CastView | undefined;

  /**
   * The prediction mirror's side of a cast (§II.6 R2, §II.3.9): fires only the spell's mirror-safe cast cue
   * (`SpellCues.cast`) on the caster, with the options' input and key, into the system's cue buffer, and starts no
   * cast. The client notes the event in its echo ring, so the server's copy (same cue, owner and key) is dropped.
   * Returns whether a cue was fired.
   */
  readonly predictCast: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => boolean;
}

/** A spell system: a class for fast properties, its functions arrow fields so they work detached. */
class Spells<G extends SpellTypes> implements SpellSystem<G> {
  readonly registry: SpellRegistry<G>;
  readonly pool: SpellSystem<G>['pool'];
  readonly delayed: SpellSystem<G>['delayed'];
  readonly procKinds: SpellProcKinds<G>;
  readonly gameActivations: readonly string[];
  readonly #engine: SpellEngine<G>;
  readonly #report = new Report();
  #request: MutableRequest<G> | undefined = undefined;

  constructor(engine: SpellEngine<G>) {
    this.#engine = engine;
    this.registry = engine.registry;

    this.pool = {
      get created() {
        return engine.pool.created;
      },

      get live() {
        return engine.pool.live;
      },
    };
    this.delayed = {
      get pending() {
        return engine.delayed.size;
      },

      get created() {
        return engine.delayed.created;
      },
    };
    this.procKinds = createSpellProcKinds({ engine, cast: this.cast });
    this.gameActivations = gameActivationsOf(engine.registry.activations);
  }

  readonly createCasterState = (): CasterState => new CasterRecord(this.registry.autoIds.length);

  readonly cast = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): CastReport =>
    startCast(this.#engine, this.#requestOf(caster, spell, options), this.#report);

  /** The system's one request, rewritten: the cast order reads it before any hook runs, so a nested cast may reuse it. */
  #requestOf(caster: G['bearer'], spell: SpellId, options: CastOptions<G> | undefined): CastRequest<G> {
    const request = (this.#request ??= new MutableRequest<G>(caster, spell));

    request.caster = caster;
    request.spell = spell;
    request.options = options ?? NO_OPTIONS;

    return request;
  }

  readonly check = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): CastRefusal | undefined =>
    checkCast(this.#engine, this.#requestOf(caster, spell, options));

  readonly hit = (cast: CastHandle, hit: SpellHit<G>): number => hitCast(this.#engine, cast, hit);

  readonly get = (cast: CastHandle): SpellContext<G> | undefined => this.#engine.castOf(cast);

  readonly isRunning = (cast: CastHandle): boolean => {
    const stage = this.#engine.castOf(cast)?.stage;

    return stage !== undefined && stage !== 'ended';
  };

  readonly isCasting = (caster: G['bearer'], spell?: SpellId): boolean => isCasting(this.#engine, caster, spell);

  readonly castsOf = (caster: G['bearer'], out: CastHandle[]): number => recordOf(caster).copyInto(out);

  readonly stepAuto = (caster: G['bearer']): void => {
    stepAutoClocks(this.#engine, caster, this.cast);
  };

  readonly autoClock = (caster: G['bearer'], spell: SpellId): number => autoClockOf(this.#engine, caster, spell);

  readonly stepDelayed = (slot?: TickSlotId): number => this.#engine.delayed.land(slot ?? 0);

  readonly step = (caster: G['bearer']): void => {
    stepCaster(this.#engine, caster);
  };

  readonly withdrawDelayed = (owner: G['bearer']): number => this.#engine.delayed.withdraw(owner);

  readonly pause = (cast: CastHandle): boolean => setPause(this.#engine, cast, { bits: MANUAL_PAUSE, isOn: true });
  readonly resume = (cast: CastHandle): boolean => setPause(this.#engine, cast, { bits: MANUAL_PAUSE, isOn: false });
  readonly cancel = (cast: CastHandle): boolean => cancelCast(this.#engine, cast);

  readonly finish = (cast: CastHandle, outcome: Exclude<CastOutcome, 'cancelled'>): boolean =>
    finishCast(this.#engine, cast, outcome);

  readonly interrupt = (caster: G['bearer'], reason: G['interrupt']): number =>
    interruptCaster(this.#engine, caster, { reason, isOn: true });

  readonly endInterrupt = (caster: G['bearer'], reason: G['interrupt']): number =>
    interruptCaster(this.#engine, caster, { reason, isOn: false });

  readonly isInterrupted = (caster: G['bearer'], reason: G['interrupt']): boolean =>
    (recordOf(caster).interrupts & (this.#engine.interruptBits.get(reason) ?? 0)) !== 0;

  readonly cancelAll = (caster: G['bearer']): number => cancelCaster(this.#engine, caster);

  readonly interruptMask = (reasons: readonly G['interrupt'][]): number =>
    reasons.reduce((mask, reason) => mask | (this.#engine.interruptBits.get(reason) ?? unknownInterrupt(reason)), 0);

  readonly heldInterrupts = (caster: G['bearer']): number => recordOf(caster).interrupts;

  get current(): CastHandle {
    return this.#engine.current?.cast ?? NO_CAST;
  }

  readonly hold = (cast: CastHandle): boolean => {
    const record = this.#engine.castOf(cast);

    if (record === undefined) {
      return false;
    }

    record.holds += 1;

    return true;
  };

  readonly release = (cast: CastHandle): void => {
    const record = this.#engine.castOf(cast);

    if (record !== undefined) {
      this.#engine.unhold(record);
    }
  };

  readonly enter = (cast: CastHandle): CastHandle => {
    const engine = this.#engine;
    const previous = engine.current?.cast ?? NO_CAST;

    engine.current = engine.castOf(cast);

    return previous;
  };

  readonly leave = (previous: CastHandle): void => {
    this.#engine.current = this.#engine.castOf(previous);
  };

  readonly viewOf = (cast: CastHandle): CastView | undefined => viewCast(this.#engine, cast);

  readonly rescaleClocks = (caster: G['bearer'], rescale: ClockScale): number =>
    rescaleClocks(this.#engine, caster, rescale);

  readonly predictCast = (caster: G['bearer'], spell: SpellId, options: CastOptions<G> = NO_OPTIONS): boolean => {
    this.registry.get(spell);

    return fireCastCue(this.#engine, caster, [spell, options.input, options.key ?? 0]);
  };

  readonly shareOf = (spell: SpellId, stat: StatId): number | undefined => {
    const share = this.registry.shares[spell]?.[stat];

    return share === undefined || Number.isNaN(share) ? undefined : share;
  };
}

/** An interrupt with no bit: neither declared by the game nor named by a timeline. */
const unknownInterrupt = (reason: string): never => {
  throw new RangeError(`Interrupt ${reason} is not one the spell system knows: declare it in its interrupts.`);
};

/**
 * Creates the spell system over a game's spells (§I.5): `createSpellSystem({ registry: SPELLS, auras, procs: () =>
 * procs, clock, host })`. Every cast aura is resolved and every plan built at load; nothing is looked up by name
 * afterwards.
 */
export const createSpellSystem = <G extends SpellTypes>(options: SpellSystemOptions<G>): SpellSystem<G> =>
  Object.freeze(new Spells(engineOf(options)));
