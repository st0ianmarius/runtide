import type { StatView } from './compiled.ts';
import type { StatId } from './stat-id.ts';

/** A stat view over base values alone, by stat id: every total is the base (0 for a stat past the list). */
class BasesView implements StatView {
  readonly #bases: ArrayLike<number>;

  constructor(bases: ArrayLike<number>) {
    this.#bases = bases;
  }

  total(stat: StatId): number {
    return this.#bases[stat] ?? 0;
  }

  base(stat: StatId): number {
    return this.#bases[stat] ?? 0;
  }
}

/**
 * A stat view of bases alone, with no modifiers: a stat table's bases (what a cast or a cooldown reads without a stats
 * host), or a unit's own snapshotted bases in a game with no modifier system.
 */
export const basesView = (bases: ArrayLike<number>): StatView => new BasesView(bases);
