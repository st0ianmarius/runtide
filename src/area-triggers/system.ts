import type { TickSlotId } from '../core/index.ts';
import type { AreaTriggerContext, EndReason } from './area-def.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import { areaEngineOf } from './build-engine.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
import { createAreaTriggerProcKinds } from './proc-kinds.ts';
import type { AreaTriggerProcKinds } from './procs.ts';
import { type AreaQueries, type AreaQuery, checkReason, despawnWhere } from './queries.ts';
import { type AreaReplica, replicateAreas } from './replication.ts';
import { spawnArea, type SpawnSpec } from './spawner.ts';
import { endOwned, stepSlot } from './stepper.ts';
import type { AreaTriggerSystemOptions } from './system-options.ts';

/**
 * An area trigger system: the store of what spells leave in the world. It spawns them (applying limits), steps
 * them per tick slot in the pinned order (kind order, then creation order, children after their parents), counts
 * their lifetimes, checks their bounds, runs their hooks' procs as their owners' and their casts', and ends them with
 * a reason.
 */
export interface AreaTriggerSystem<G extends AreaTriggerTypes> extends AreaQueries<G> {
  /** The game's area trigger kinds. */
  readonly registry: AreaTriggerRegistry<G>;

  /** How many records the pool has made, and how many are live: a steady state makes no new ones. */
  readonly pool: {
    /** Records ever made. */
    readonly created: number;

    /** Area triggers live now. */
    readonly live: number;

    /** Hit ledgers live now. */
    readonly ledgers: number;
  };

  /** The proc kind `spawn`: `createProcRegistry({ ...CORE_PROCS, ...areaTriggers.procKinds })`. */
  readonly procKinds: AreaTriggerProcKinds<G>;

  /** The area trigger whose hook's procs are running now, or none. */
  readonly current: AreaTriggerHandle;

  /**
   * Spawns an area trigger of a kind: returns its handle, or `NO_AREA_TRIGGER` when its limit refused it.
   * Its first frame is the next tick's, unless it flies `now`.
   */
  readonly spawn: (kind: AreaTriggerId, spec: SpawnSpec<G>) => AreaTriggerHandle;

  /**
   * Steps every area trigger of a tick slot (the first when absent) once, in the pinned order; one
   * that spawned this tick waits for the next. Returns how many stepped. The host calls it inside its own loop.
   */
  readonly step: (slot?: TickSlotId) => number;

  /** Steps one owner's area triggers of a tick slot (the first when absent), in the same order: a per-owner stepper. */
  readonly stepOwner: (owner: G['bearer'], slot?: TickSlotId) => number;

  /** Whether an area trigger is live. */
  readonly isLive: (handle: AreaTriggerHandle) => boolean;

  /** Ends a live area trigger now with a reason (`self` by default); false for one already gone. */
  readonly despawn: (handle: AreaTriggerHandle, reason?: EndReason<G>) => boolean;

  /** Sets a live area trigger's seconds left (`c.setRemaining`); false for one already gone. */
  readonly setRemaining: (handle: AreaTriggerHandle, seconds: number) => boolean;

  /** How many area triggers of a kind an owner has live. */
  readonly countOf: (owner: G['bearer'], kind: AreaTriggerId) => number;

  /** Ends every area trigger a query keeps, with a reason (`self` by default); returns how many ended. */
  readonly despawnWhere: (query: AreaQuery<G>, reason?: EndReason<G>) => number;

  /**
   * An owner left the world (its despawn): every area trigger of it that needs it (living while it does, bound to its
   * presence, anchored on it) ends as `source-gone`; the rest live on. Returns how many ended.
   */
  readonly ownerGone: (owner: G['bearer']) => number;

  /**
   * Writes the replicated state of every live area trigger whose kind replicates its state, and that `admit` keeps (a
   * client's interest: those near its unit), into `out` from index 0; returns how many. `out` keeps its replicas.
   */
  readonly replicate: (out: AreaReplica[], admit?: (area: AreaTriggerContext<G>) => boolean) => number;
}

/** An area trigger system: a class for fast properties, its functions arrow fields so they work detached. */
class AreaTriggers<G extends AreaTriggerTypes> implements AreaTriggerSystem<G> {
  readonly registry: AreaTriggerRegistry<G>;
  readonly pool: AreaTriggerSystem<G>['pool'];
  readonly procKinds: AreaTriggerProcKinds<G>;
  readonly query: AreaQueries<G>['query'];
  readonly get: AreaQueries<G>['get'];
  readonly viewOf: AreaQueries<G>['viewOf'];
  readonly coveredBy: AreaQueries<G>['coveredBy'];
  readonly intercept: AreaQueries<G>['intercept'];
  readonly #engine: AreaEngine<G>;

  constructor(engine: AreaEngine<G>) {
    this.#engine = engine;
    this.registry = engine.registry;

    this.pool = {
      get created() {
        return engine.pool.created;
      },

      get live() {
        return engine.pool.live;
      },

      get ledgers() {
        return engine.ledgers.live;
      }
    };
    this.procKinds = createAreaTriggerProcKinds(engine);
    this.query = engine.queries.query;
    this.get = engine.queries.get;
    this.viewOf = engine.queries.viewOf;
    this.coveredBy = engine.queries.coveredBy;
    this.intercept = engine.queries.intercept;
  }

  get current(): AreaTriggerHandle {
    return this.#engine.current?.handle ?? NO_AREA_TRIGGER;
  }

  readonly spawn = (kind: AreaTriggerId, spec: SpawnSpec<G>): AreaTriggerHandle => {
    this.registry.get(kind);

    return spawnArea(this.#engine, kind, spec);
  };

  readonly step = (slot?: TickSlotId): number => stepSlot(this.#engine, slot ?? 0, undefined);

  readonly stepOwner = (owner: G['bearer'], slot?: TickSlotId): number => stepSlot(this.#engine, slot ?? 0, owner);

  readonly isLive = (handle: AreaTriggerHandle): boolean => this.#engine.areaOf(handle) !== undefined;

  readonly setRemaining = (handle: AreaTriggerHandle, seconds: number): boolean => {
    const area = this.#engine.areaOf(handle);

    area?.setRemaining(seconds);

    return area !== undefined;
  };

  readonly despawn = (handle: AreaTriggerHandle, reason: EndReason<G> = 'self'): boolean => {
    checkReason(this.#engine, reason);

    const area = this.#engine.areaOf(handle);

    if (area === undefined) {
      return false;
    }

    endArea(this.#engine, area, { reason });

    return true;
  };

  readonly countOf = (owner: G['bearer'], kind: AreaTriggerId): number => this.#engine.countOf(owner, kind);

  readonly ownerGone = (owner: G['bearer']): number => endOwned(this.#engine, owner);

  readonly despawnWhere = (query: AreaQuery<G>, reason: EndReason<G> = 'self'): number => {
    checkReason(this.#engine, reason);

    return despawnWhere(this.#engine, query, reason);
  };

  readonly replicate = (out: AreaReplica[], admit?: (area: AreaTriggerContext<G>) => boolean): number =>
    replicateAreas(this.#engine, out, admit);
}

/**
 * Creates the area trigger system over a game's kinds: `createAreaTriggerSystem({ registry: AREA_TRIGGERS,
 * spells, auras, procs: () => procs, world, clock, host })`. Every owner aura is resolved and every kind's tick slot
 * checked at load.
 */
export const createAreaTriggerSystem = <G extends AreaTriggerTypes>(
  options: AreaTriggerSystemOptions<G>
): AreaTriggerSystem<G> => Object.freeze(new AreaTriggers(areaEngineOf(options)));
