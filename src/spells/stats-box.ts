import {
  finishScaled,
  type ScaledSnapshot,
  snapshotScaled,
  type StatId,
  type StatTable,
  type StatView,
} from '../modifiers/index.ts';
import type { CompiledStats } from './compile-stats.ts';
import type { SpellId } from './spell-types.ts';

/**
 * One cast's stats storage for a spell with a stats table, pooled per spell so every cast of a spell reads objects of
 * one shape: the plain numbers, the proc amounts, and the snapshots behind them, reused cast after cast.
 */
export class StatsBox {
  /** The numbers: each value's caster part, target terms left out. */
  readonly stats: Record<string, number>;

  /** The proc amounts: a snapshot for a value with target terms, its number otherwise. */
  readonly scaled: Record<string, number | ScaledSnapshot>;

  /** The snapshot of each value, by its index in the table, made on first use and then reused. */
  readonly snapshots: (ScaledSnapshot | undefined)[] = [];

  constructor(keys: readonly string[]) {
    this.stats = Object.fromEntries(keys.map((key) => [key, 0]));
    this.scaled = Object.fromEntries(keys.map((key) => [key, 0]));
  }
}

/** A view of the stat table's bases: what a cast reads when the host has no `statsOf`. */
class BaseView implements StatView {
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

/** The view of the bases of a game's stat table, or of no stats (every read 0) when it has none. */
export const baseView = (stats: StatTable | undefined): StatView => new BaseView(stats?.columns.base ?? []);

/** The free boxes of every spell, by spell id. */
export class StatsBoxes {
  readonly #free: StatsBox[][] = [];
  readonly #compiled: readonly (CompiledStats | undefined)[];

  constructor(compiled: readonly (CompiledStats | undefined)[]) {
    this.#compiled = compiled;
  }

  /** A box for a cast of `spell`, reused when one is free. */
  take(spell: SpellId): StatsBox {
    return this.#free[spell]?.pop() ?? new StatsBox(this.#compiled[spell]?.keys ?? []);
  }

  /** Gives a box back once its cast is over. */
  give(spell: SpellId, box: StatsBox): void {
    (this.#free[spell] ??= []).push(box);
  }
}

/**
 * Takes a table's stats into a box (decision 2): each value's caster part is snapshotted from `view` at
 * `rank` into the box's reused snapshot, its number is that part (target terms left out), and its proc amount is the
 * snapshot when it has target terms, else the number. Allocates nothing once the box has been used.
 */
export const takeTable = (
  box: StatsBox,
  compiled: CompiledStats,
  ctx: {
    /** The caster's stats. */
    readonly caster: StatView;

    /** The rank. */
    readonly rank: number;
  },
): void => {
  const { keys, values } = compiled;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? '';
    const value = values[i];

    if (value === undefined) {
      continue;
    }

    const snapshot = snapshotScaled(value, ctx, box.snapshots[i]);
    const number = finishScaled(snapshot);

    box.snapshots[i] = snapshot;
    box.stats[key] = number;
    box.scaled[key] = value.hasTarget ? snapshot : number;
  }
};
