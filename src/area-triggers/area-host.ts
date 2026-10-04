import type { SpellHost } from '../spells/index.ts';
import type { AreaTriggerTypes } from './area-types.ts';

/**
 * The narrow host an area trigger system runs against: the spell host's services, plus what only area triggers
 * ask. Every member is optional; without one, the matching rule is the default below.
 */
export interface AreaTriggerHost<G extends AreaTriggerTypes> extends SpellHost<G> {
  /**
   * Allocates an area trigger's entity id from the game's shared counter, so area triggers, units and
   * casts share one id space. Without it the system counts its own ids from 1.
   */
  readonly allocateId?: () => number;

  /**
   * A unit's side, which an area trigger it spawns keeps for its catches: the world's `sideOf` when absent. A memory
   * world's throws "The unit is not in the world" for an owner with no body there (a world script's), so a game whose
   * world scripts spawn area triggers supplies this, and the spell host's `positionOf` too for its owner-anchored kinds
   * and its `spawn` procs without `at`.
   */
  readonly sideOf?: (unit: G['bearer']) => number;

  /**
   * Whether a unit has left life (dead or despawned). An area trigger whose lifetime, bound or anchor is its owner,
   * spawned for an owner already gone (by a proc list still running for it after a hook killed it, past `ownerGone`),
   * ends at once as `source-gone`. Without it, only `ownerGone` ends an owner's area triggers. The unit system's
   * `units.hosts.area` provides it.
   */
  readonly isGone?: (unit: G['bearer']) => boolean;
}
