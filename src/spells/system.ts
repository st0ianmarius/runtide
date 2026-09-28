import type { TickSlotId } from '../core/index.ts';
import type { StatId } from '../modifiers/index.ts';
import { engineOf, gameActivationsOf } from './build-engine.ts';
import { CasterRecord, type CasterState, recordOf } from './caster.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { SpellEngine } from './engine.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import { createSpellProcKinds } from './proc-kinds.ts';
import type { SpellProcKinds } from './procs.ts';
import {
  type CastOptions,
  type CastReport,
  type CastRequest,
  hitCast,
  NO_OPTIONS,
  Report,
  startCast,
} from './runner.ts';
import type { CastOutcome, SpellContext, SpellHit } from './spell-def.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import { cancelCast, finishCast, interruptCaster, MANUAL_PAUSE, setPause, stepCaster } from './stepper.ts';
import type { SpellSystemOptions } from './system-options.ts';

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
   * Lands every delayed list of a tick slot (the first when absent) due by the clock's tick, in the order they were
   * scheduled, each for its origin as its cast's procs; returns how many landed. The host calls it in its own loop.
   */
  readonly stepDelayed: (slot?: TickSlotId) => number;

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
   * An interrupt hits a caster (F16: a stun, a freeze, a death): each running cast answers it as its timeline says,
   * pausing until `endInterrupt` or cancelling; returns how many answered.
   */
  readonly interrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /** An interrupt on a caster ends: the casts it paused count down again (unless something else pauses them). */
  readonly endInterrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /**
   * A spell's share of an outgoing multiplier stat (§II.3.13: `SpellDef.scaling`), or `undefined` for a share of 1:
   * what the damage host's `shareOf` answers with (`shareOf: spells.shareOf`).
   */
  readonly shareOf: (spell: SpellId, stat: StatId) => number | undefined;
}

/** The request a system reuses for every cast. */
class MutableRequest<G extends SpellTypes> implements CastRequest<G> {
  caster: G['bearer'];
  spell: SpellId;
  options: CastOptions<G> = NO_OPTIONS;

  constructor(caster: G['bearer'], spell: SpellId) {
    this.caster = caster;
    this.spell = spell;
  }
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

  readonly cast = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): CastReport => {
    // One request per system: the cast order reads it before any hook runs, so a nested cast may rewrite it.
    const request = (this.#request ??= new MutableRequest<G>(caster, spell));

    request.caster = caster;
    request.spell = spell;
    request.options = options ?? NO_OPTIONS;

    return startCast(this.#engine, request, this.#report);
  };

  readonly hit = (cast: CastHandle, hit: SpellHit<G>): number => hitCast(this.#engine, cast, hit);

  readonly get = (cast: CastHandle): SpellContext<G> | undefined => this.#engine.castOf(cast);

  readonly isRunning = (cast: CastHandle): boolean => {
    const stage = this.#engine.castOf(cast)?.stage;

    return stage !== undefined && stage !== 'ended';
  };

  readonly isCasting = (caster: G['bearer'], spell?: SpellId): boolean => {
    const record = recordOf(caster);

    if (spell === undefined) {
      return record.count > 0;
    }

    for (let i = 0; i < record.count; i++) {
      if (this.#engine.castOf(record.handles[i] ?? NO_CAST)?.spell === spell) {
        return true;
      }
    }

    return false;
  };

  readonly castsOf = (caster: G['bearer'], out: CastHandle[]): number => {
    const record = recordOf(caster);

    for (let i = 0; i < record.count; i++) {
      out[i] = record.handles[i] ?? NO_CAST;
    }

    return record.count;
  };

  readonly stepDelayed = (slot?: TickSlotId): number => this.#engine.delayed.land(slot ?? 0);

  readonly step = (caster: G['bearer']): void => {
    stepCaster(this.#engine, caster);
  };

  readonly pause = (cast: CastHandle): boolean => setPause(this.#engine, cast, { bits: MANUAL_PAUSE, isOn: true });
  readonly resume = (cast: CastHandle): boolean => setPause(this.#engine, cast, { bits: MANUAL_PAUSE, isOn: false });
  readonly cancel = (cast: CastHandle): boolean => cancelCast(this.#engine, cast);

  readonly finish = (cast: CastHandle, outcome: Exclude<CastOutcome, 'cancelled'>): boolean =>
    finishCast(this.#engine, cast, outcome);

  readonly interrupt = (caster: G['bearer'], reason: G['interrupt']): number =>
    interruptCaster(this.#engine, caster, { reason, isOn: true });

  readonly endInterrupt = (caster: G['bearer'], reason: G['interrupt']): number =>
    interruptCaster(this.#engine, caster, { reason, isOn: false });

  readonly shareOf = (spell: SpellId, stat: StatId): number | undefined => {
    const share = this.registry.shares[spell]?.[stat];

    return share === undefined || Number.isNaN(share) ? undefined : share;
  };
}

/**
 * Creates the spell system over a game's spells (§I.5): `createSpellSystem({ registry: SPELLS, auras, procs: () =>
 * procs, clock, host })`. Every cast aura is resolved and every plan built at load; nothing is looked up by name
 * afterwards.
 */
export const createSpellSystem = <G extends SpellTypes>(options: SpellSystemOptions<G>): SpellSystem<G> =>
  Object.freeze(new Spells(engineOf(options)));
