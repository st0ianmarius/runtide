import type { SpellHost } from '../spells/index.ts';
import type { AreaTriggerTypes } from './area-types.ts';

/**
 * The narrow host an area trigger system runs against (§I.5): the spell host's services, plus what only area triggers
 * ask. Every member is optional; without one, the matching rule is the default below.
 */
export interface AreaTriggerHost<G extends AreaTriggerTypes> extends SpellHost<G> {
  /**
   * Allocates an area trigger's entity id from the game's shared counter (§II.6 W4), so area triggers, units and
   * casts share one id space. Without it the system counts its own ids from 1.
   */
  readonly allocateId?: () => number;

  /** Whether a unit is still in the world (a `present` bound, the dies-with-source rule); true when absent. */
  readonly isPresent?: (unit: G['bearer']) => boolean;

  /** Whether a unit is standing (not down, not dead): what a `standing` bound reads; true when absent. */
  readonly isStanding?: (unit: G['bearer']) => boolean;
}
