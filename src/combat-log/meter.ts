import type { CombatEntry } from './entry.ts';
import type { CombatLog } from './log.ts';

/** One row of a meter's ranking. */
export interface MeterRow {
  /** The entity credited. */
  readonly source: number;

  /** The damage it is credited with. */
  readonly damage: number;
}

/**
 * A damage meter (§II.6 D2, §I.7.1 F11): a combat log subscriber that sums, per entity, the damage it is credited
 * with (what reached health plus what absorbs took), the healing it gave (what a heal gave back, overheal left out),
 * and the damage each target took (what reached health).
 */
export interface DamageMeter {
  /** The damage an entity is credited with. */
  readonly damageBy: (source: number) => number;

  /** The healing an entity is credited with. */
  readonly healingBy: (source: number) => number;

  /** The damage a unit took. */
  readonly takenBy: (target: number) => number;

  /** Every entity credited with damage, highest first, ties by lower id: what a meter shows. */
  readonly ranking: () => MeterRow[];

  /** Starts every sum again (a new encounter). */
  readonly reset: () => void;

  /** Stops listening to the log. */
  readonly close: () => void;
}

/** Adds an amount to an entity's sum. */
const addTo = (sums: Map<number, number>, id: number, amount: number): void => {
  if (amount !== 0) {
    sums.set(id, (sums.get(id) ?? 0) + amount);
  }
};

/** Creates a damage meter over a combat log, counting every entry recorded from now on. */
export const createDamageMeter = (log: CombatLog): DamageMeter => {
  const damage = new Map<number, number>();
  const healing = new Map<number, number>();
  const taken = new Map<number, number>();

  const close = log.subscribe((entry: CombatEntry) => {
    if (entry.kind === 'damage') {
      addTo(damage, entry.source, entry.amount + entry.absorbed);
      addTo(taken, entry.target, entry.amount);
    } else if (entry.kind === 'heal') {
      addTo(healing, entry.source, entry.amount);
    }
  });

  return Object.freeze({
    damageBy: (source: number) => damage.get(source) ?? 0,
    healingBy: (source: number) => healing.get(source) ?? 0,
    takenBy: (target: number) => taken.get(target) ?? 0,

    ranking: () =>
      [...damage]
        .map(([source, sum]) => ({ source, damage: sum }))
        .toSorted((a, b) => b.damage - a.damage || a.source - b.source),

    reset: () => {
      damage.clear();
      healing.clear();
      taken.clear();
    },

    close,
  });
};
