import type { Vec2 } from '../math/index.ts';
import type { StatView } from '../modifiers/index.ts';
import type { ProcHost } from '../procs/index.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/**
 * The narrow host a spell system runs against (§I.5): the proc host's services (`idOf`, `party`, `positionOf`,
 * `grant`), plus what only spells ask. Every member is optional; without one, the matching rule is the default below.
 */
export interface SpellHost<G extends SpellTypes> extends ProcHost<G> {
  /**
   * The caster's stats for one spell (folded with the spell's tags as scopes, as a scoped modifier needs), which a
   * stats table and a `stats` function read. Without it, a stats table reads the stat table's bases.
   */
  readonly statsOf?: (caster: G['bearer'], spell: SpellId) => StatView | undefined;

  /**
   * The game's own cast rules (§II.6 S5, F16: a stunned or dead caster casts nothing), asked first in the cast order,
   * before the activation kind's gate; a false refuses the cast. Every cast may start when absent.
   */
  readonly canAct?: (caster: G['bearer'], spell: SpellId) => boolean;

  /**
   * The point of a cast's target, for its reach rules (§I.7.1 F16): a unit's position, a placement's point. A spell's
   * own `reach.pointOf` comes first, and a target that is a point is its own; `undefined` when it does not know one.
   */
  readonly pointOf?: (target: unknown) => Vec2 | undefined;

  /**
   * Whether a caster owns a spell (§I.7.1 F20: the game's own record of what a unit has, such as its cards): an `auto`
   * spell's clock casts only while it is owned, and counts either way. Every spell is owned when absent.
   */
  readonly owns?: (caster: G['bearer'], spell: SpellId) => boolean;

  /**
   * A caster's rank of a spell (§I.7.1 F20), from 1: what a cast is given when its options name no rank, so an `auto`
   * clock, a triggered cast or a `castSpell` outside a cast reads the caster's own rank (a card's rank). `undefined`
   * (and an absent hook) gives rank 1.
   */
  readonly rankOf?: (caster: G['bearer'], spell: SpellId) => number | undefined;

  /**
   * A caster's variant of a spell (§I.7.1 F20: 1 for a legendary), what a cast is given when its options name none.
   * `undefined` (and an absent hook) gives variant 0.
   */
  readonly variantOf?: (caster: G['bearer'], spell: SpellId) => number | undefined;
}
