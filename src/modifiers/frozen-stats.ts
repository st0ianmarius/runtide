import type { StatView } from './compiled.ts';
import type { StatId } from './stat-id.ts';

/**
 * Some of a unit's stats as they were when taken: what a damage over time keeps of its caster, so its beats deal what
 * the cast would have (a blow's `attackerStats`), even once the caster is gone or its buffs ran out. Reading a stat it
 * did not take throws, since a blow reading one live would mix two moments.
 */
export class FrozenStats implements StatView {
  readonly #totals: Float64Array;
  readonly #bases: Float64Array;
  readonly #taken: Uint8Array;

  constructor(size: number) {
    this.#totals = new Float64Array(size);
    this.#bases = new Float64Array(size);
    this.#taken = new Uint8Array(size);
  }

  /** Takes stats from a view, forgetting any taken before; the stats must lie below the size it was made with. */
  take(view: StatView, stats: readonly StatId[]): this {
    this.#taken.fill(0);

    for (const stat of stats) {
      if (!(stat >= 0 && stat < this.#taken.length)) {
        throw new RangeError(`Stat ${stat} is past the ${this.#taken.length} stats these frozen stats hold.`);
      }

      this.#totals[stat] = view.total(stat);
      this.#bases[stat] = view.base(stat);
      this.#taken[stat] = 1;
    }

    return this;
  }

  total(stat: StatId): number {
    return this.#read(this.#totals, stat);
  }

  base(stat: StatId): number {
    return this.#read(this.#bases, stat);
  }

  /** A taken stat's number; throws for one not taken. */
  #read(column: Float64Array, stat: StatId): number {
    if (this.#taken[stat] !== 1) {
      throw new RangeError(`Stat ${stat} was not frozen: take every stat the blow reads.`);
    }

    return column[stat] ?? 0;
  }
}

/**
 * Freezes some stats of a view (a caster's, as its damage over time lands), into `into` when given (an aura's own
 * record, reused on a refresh), else a new one sized for the stats named.
 */
export const freezeStats = (view: StatView, stats: readonly StatId[], into?: FrozenStats): FrozenStats =>
  (into ?? new FrozenStats(Math.max(-1, ...stats) + 1)).take(view, stats);
