import type { CombatEntry } from './entry.ts';
import type { CombatLog } from './log.ts';

/** One row of a meter's ranking. */
export interface MeterRow {
  /** The entity credited. */
  readonly source: number;

  /** The damage it is credited with. */
  readonly damage: number;
}

/** One row of a meter's per-spell breakdown of an entity's damage. */
export interface SpellMeterRow {
  /** The spell (−1 for blows with none). */
  readonly spell: number;

  /** The damage dealt with it (what reached health). */
  readonly damage: number;
}

/**
 * A damage meter: a combat log subscriber that sums, per entity, the damage it is credited
 * with (what reached health plus what absorbs took), the healing it gave (what a heal gave back, overheal left out),
 * and the damage each target took (what reached health). Per entity and spell it sums the damage dealt only (what
 * reached health, absorbs left out), so a spell breakdown adds up to `damageBy` only when nothing was absorbed.
 */
export interface DamageMeter {
  /** The damage an entity is credited with. */
  readonly damageBy: (source: number) => number;

  /** The damage an entity dealt with a spell (−1 for blows with none): what reached health, absorbs left out. */
  readonly damageBySpell: (source: number, spell: number) => number;

  /** Every spell an entity dealt damage with, highest first, ties by lower id: what a meter's breakdown shows. */
  readonly spellRanking: (source: number) => SpellMeterRow[];

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

/** Adds an amount to an entity's sum for a spell; a map is made only for an entity's first spell damage. */
const addBySpell = (sums: Map<number, Map<number, number>>, entry: CombatEntry): void => {
  if (entry.amount === 0) {
    return;
  }

  let spells = sums.get(entry.source);

  if (spells === undefined) {
    spells = new Map();
    sums.set(entry.source, spells);
  }

  addTo(spells, entry.spell, entry.amount);
};

/** Creates a damage meter over a combat log, counting every entry recorded from now on. */
export const createDamageMeter = (log: CombatLog): DamageMeter => {
  const damage = new Map<number, number>();
  const bySpell = new Map<number, Map<number, number>>();
  const healing = new Map<number, number>();
  const taken = new Map<number, number>();

  const close = log.subscribe((entry: CombatEntry) => {
    if (entry.kind === 'damage') {
      addTo(damage, entry.source, entry.amount + entry.absorbed);
      addBySpell(bySpell, entry);
      addTo(taken, entry.target, entry.amount);
    } else if (entry.kind === 'heal') {
      addTo(healing, entry.source, entry.amount);
    }
  });

  return Object.freeze({
    damageBy: (source: number) => damage.get(source) ?? 0,
    damageBySpell: (source: number, spell: number) => bySpell.get(source)?.get(spell) ?? 0,

    spellRanking: (source: number) =>
      [...(bySpell.get(source) ?? [])]
        .map(([spell, sum]) => ({ spell, damage: sum }))
        .toSorted((a, b) => b.damage - a.damage || a.spell - b.spell),

    healingBy: (source: number) => healing.get(source) ?? 0,
    takenBy: (target: number) => taken.get(target) ?? 0,

    ranking: () =>
      [...damage]
        .map(([source, sum]) => ({ source, damage: sum }))
        .toSorted((a, b) => b.damage - a.damage || a.source - b.source),

    reset: () => {
      damage.clear();
      bySpell.clear();
      healing.clear();
      taken.clear();
    },

    close
  });
};
