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
   * Whether a caster owns a spell (the spellbook's answer, F20): an `auto` spell's clock casts only while it is owned,
   * and counts either way. Every spell is owned when absent.
   */
  readonly owns?: (caster: G['bearer'], spell: SpellId) => boolean;
}
