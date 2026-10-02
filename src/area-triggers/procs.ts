import type { Vec2 } from '../math/index.ts';
import type { ChanceOption, ProcContext, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { AreaTriggerContext, EndReason } from './area-def.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';

/**
 * Spawns an area trigger: owned by the list's self, credited to its source, belonging to the cast
 * whose procs are running and to the area trigger whose procs are running (its parent). It lands when the area trigger
 * spawns, and is refused when its kind's limit refuses it.
 */
export interface SpawnProc<G extends AreaTriggerTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'spawn';

  /** The kind: its name in data, its id in code. */
  readonly areaTrigger: G['areaTriggerName'] | AreaTriggerId;

  /** The unit it spawns on, when it names no point; the list's self when absent. */
  readonly to?: ProcTarget<G>;

  /** The point it spawns at, in place of a unit's position. */
  readonly at?: Vec2;

  /** Reads the point when the proc applies (an aim point, the event unit's corpse), in place of `at`. */
  readonly atOf?: (ctx: ProcContext<G>) => Vec2 | undefined;

  /** The heading it faces; its parent's (or 0) when absent. */
  readonly heading?: number;

  /** Reads the heading when the proc applies, in place of `heading`. */
  readonly headingOf?: (ctx: ProcContext<G>) => number;

  /** What its `init` is handed. */
  readonly input?: G['areaInput'];

  /** Reads what its `init` is handed when the proc applies, in place of `input`. */
  readonly inputOf?: (ctx: ProcContext<G>) => G['areaInput'] | undefined;

  /** The seconds of this frame it flies at once (a fork with its parent's leftover time); next tick when absent. */
  readonly now?: number;

  /** Its `now` read as it spawns, in place of `now`: a prepared list's fork reading its parent's leftover time. */
  readonly nowOf?: (ctx: ProcContext<G>) => number | undefined;
}

/**
 * Withdraws what a unit owns and has not fired (an elite's enrage withdrawing its own
 * telegraphs, from casts that already ended too): its live area triggers (those with a tag, or every one), ended with
 * a reason, and its delayed lists that have not landed. Its amount is how many it withdrew; `skipped` for none.
 */
export interface DespawnOwnedProc<G extends AreaTriggerTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'despawnOwned';

  /** Whose; the list's self when absent. */
  readonly to?: ProcTarget<G>;

  /** Only area triggers with this tag (`telegraph`); every one the unit owns when absent. */
  readonly tag?: G['areaTag'];

  /**
   * Only area triggers it keeps: the unfired ones, read from their state (Swarm's telegraphs linger as fired markers);
   * every one the tag keeps when absent.
   */
  readonly filter?: (c: AreaTriggerContext<G>) => boolean;

  /** Whether its delayed lists are withdrawn too (`withdraw`, the default) or kept (`keep`). */
  readonly delayed?: 'withdraw' | 'keep';

  /** Why its area triggers end; `self` when absent. */
  readonly reason?: EndReason<G>;
}

/** The area trigger system's proc kinds, as a union: a game adds them to its proc union (`gameProc`). */
export type AreaTriggerProcs<G extends AreaTriggerTypes> = SpawnProc<G> | DespawnOwnedProc<G>;

/** The area trigger system's proc kinds, by name: `createProcRegistry({ ...CORE_PROCS, ...areaTriggers.procKinds })`. */
export interface AreaTriggerProcKinds<G extends AreaTriggerTypes> {
  /** Spawns an area trigger. */
  readonly spawn: ProcKindDef<SpawnProc<G>, G>;

  /** Withdraws what a unit owns and has not fired. */
  readonly despawnOwned: ProcKindDef<DespawnOwnedProc<G>, G>;
}

/** A `spawn` proc: `spawn('pool')`, `spawn('fork', { heading: 0.5, now: 0.1, to: 'eventUnit' })`. */
export const spawn = <G extends AreaTriggerTypes = AreaTriggerTypes>(
  areaTrigger: G['areaTriggerName'] | AreaTriggerId,
  options: ChanceOption & Omit<SpawnProc<G>, 'kind' | 'areaTrigger' | 'chance'> = {}
): SpawnProc<G> => ({ ...options, kind: 'spawn', areaTrigger });

/**
 * A `despawnOwned` proc: `despawnOwned({ tag: 'telegraph' })` withdraws the list's self's telegraphs and pending
 * delayed lists.
 */
export const despawnOwned = <G extends AreaTriggerTypes = AreaTriggerTypes>(
  options: ChanceOption & Omit<DespawnOwnedProc<G>, 'kind' | 'chance'> = {}
): DespawnOwnedProc<G> => ({ ...options, kind: 'despawnOwned' });
