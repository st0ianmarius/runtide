import {
  basesView,
  finishScaled,
  type ScaledSnapshot,
  snapshotScaled,
  type StatTable,
  type StatView
} from '../modifiers/index.ts';
import type { CompiledStats } from './compile-stats.ts';
import type { SpellId } from './spell-types.ts';

/**
 * One cast's stats storage for a spell with a stats table, pooled per spell so every cast of a spell reads objects of
 * one shape: the plain numbers, the proc amounts, and the snapshots behind them, reused cast after cast.
 */
export class StatsBox {
  /** The spell it belongs to, whose free list takes it back. */
  readonly spell: SpellId;

  /** The numbers: each value's caster part, target terms left out. */
  readonly stats: Record<string, number>;

  /** The proc amounts: a snapshot for a value with target terms, its number otherwise. */
  readonly scaled: Record<string, number | ScaledSnapshot>;

  /** The snapshot of each value, by its index in the table, made on first use and then reused. */
  readonly snapshots: (ScaledSnapshot | undefined)[] = [];

  constructor(spell: SpellId, keys: readonly string[]) {
    this.spell = spell;
    this.stats = Object.fromEntries(keys.map((key) => [key, 0]));
    this.scaled = Object.fromEntries(keys.map((key) => [key, 0]));
  }
}

/** The view of the bases of a game's stat table, or of no stats (every read 0) when it has none. */
export const baseView = (stats: StatTable | undefined): StatView => basesView(stats?.columns.base ?? []);

/** The free boxes of every spell, by spell id. */
export class StatsBoxes {
  readonly #free: StatsBox[][] = [];
  readonly #compiled: readonly (CompiledStats | undefined)[];

  constructor(compiled: readonly (CompiledStats | undefined)[]) {
    this.#compiled = compiled;
  }

  /** A box for a cast of `spell`, reused when one is free. */
  take(spell: SpellId): StatsBox {
    return this.#free[spell]?.pop() ?? new StatsBox(spell, this.#compiled[spell]?.keys ?? []);
  }

  /** Gives a box back once nothing reads it. */
  give(box: StatsBox): void {
    (this.#free[box.spell] ??= []).push(box);
  }
}

/**
 * Takes a table's stats into a box (decision 2): each value's caster part is snapshotted from `view` at
 * `rank` into the box's reused snapshot, its number is that part (target terms left out), and its proc amount is the
 * snapshot when it has target terms, else the number. Allocates nothing once the box has been used.
 */
export const takeTable = (box: StatsBox, compiled: CompiledStats, caster: StatView, rank: number): void => {
  const { keys, values } = compiled;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? '';
    const value = values[i];

    if (value === undefined) {
      continue;
    }

    const snapshot = snapshotScaled(value, caster, rank, box.snapshots[i]);
    const number = finishScaled(snapshot);

    box.snapshots[i] = snapshot;
    box.stats[key] = number;
    box.scaled[key] = value.hasTarget ? snapshot : number;
  }
};

/**
 * Copies one box of a spell into another: the numbers as they are, and each snapshot's frozen caster part into the
 * target's reused snapshot, so the copy keeps reading what `from` held when `from` is taken again. Allocates nothing
 * once `into` has been used.
 */
export const copyTable = (into: StatsBox, from: StatsBox, compiled: CompiledStats): void => {
  const { keys, values } = compiled;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? '';
    const value = values[i];
    const source = from.snapshots[i];

    if (value === undefined || source === undefined) {
      continue;
    }

    const snapshot = snapshotScaled(value, source.caster, source.rank, into.snapshots[i]);
    const number = from.stats[key] ?? 0;

    into.snapshots[i] = snapshot;
    into.stats[key] = number;
    into.scaled[key] = value.hasTarget ? snapshot : number;
  }
};
