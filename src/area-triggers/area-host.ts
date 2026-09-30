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
   * A unit's side, which an area trigger it spawns keeps for its catches: the world's `sideOf` when absent, which a
   * unit with no place in the world (a world script) has none of.
   */
  readonly sideOf?: (unit: G['bearer']) => number;
}
