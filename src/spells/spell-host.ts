import type { Vec2 } from '../math/index.ts';
import type { StatView } from '../modifiers/index.ts';
import type { ProcHost } from '../procs/index.ts';
import type { GateAnswer } from './cast-request.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/**
 * The narrow host a spell system runs against: the proc host's services (`idOf`, `unitOf`, `party`, `positionOf`,
 * `grant`), plus what only spells ask. Every member is optional; without one, the matching rule is the default below.
 */
export interface SpellHost<G extends SpellTypes> extends ProcHost<G> {
  /**
   * The caster's stats for one spell (folded with the spell's tags as scopes, as a scoped modifier needs), which a
   * stats table and a `stats` function read. Without it, a stats table reads the stat table's bases.
   */
  readonly statsOf?: (caster: G['bearer'], spell: SpellId) => StatView | undefined;

  /**
   * The game's own cast rules (a stunned or dead caster casts nothing), asked first in the cast order,
   * before the activation kind's gate; a false refuses the cast as `gate`, one of the game's reasons refuses it for
   * that reason. Every cast may start when absent.
   */
  readonly canAct?: (caster: G['bearer'], spell: SpellId) => GateAnswer<G>;

  /**
   * The point of a cast's target, for its reach rules: a unit's position, a placement's point. A spell's
   * own `reach.pointOf` comes first, and a target that is a point is its own; `undefined` when it does not know one.
   */
  readonly pointOf?: (target: unknown) => Vec2 | undefined;

  /**
   * A caster's rank of a spell, from 1: what a cast is given when its options name no rank, so an `auto`
   * clock, a triggered cast or a `castSpell` outside a cast reads the caster's own rank (a card's rank). `undefined`
   * (and an absent hook) gives rank 1.
   */
  readonly rankOf?: (caster: G['bearer'], spell: SpellId) => number | undefined;
}
