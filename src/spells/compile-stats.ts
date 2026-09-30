import { type CompiledScaled, compileScaled, type Scaled, type StatTable } from '../modifiers/index.ts';
import type { AnySpellDef, StatsSource } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/**
 * A spell's stats table compiled at load: its keys in declaration order and each key's compiled value, so
 * a cast evaluates flat term arrays and never looks a name up.
 */
export interface CompiledStats {
  /** The table's keys, in declaration order. */
  readonly keys: readonly string[];

  /** Each key's value, compiled against the game's stat table. */
  readonly values: readonly CompiledScaled[];
}

/** Whether a spell's stats are a table of scaled values (else a function, or none). */
export const isStatsTable = <G extends SpellTypes>(
  stats: StatsSource<G> | undefined
): stats is Readonly<Record<string, Scaled<G['stat']>>> => typeof stats === 'object';

/** A constant compiled without a stat table: its base only, the same at every rank. */
const constantValue = (value: number, what: string): CompiledScaled => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${what}: a stat must be a finite number.`);
  }

  return Object.freeze({
    kind: 'scaled',
    rankCount: 1,
    base: Float64Array.of(value),
    terms: Object.freeze([]),
    curve: undefined,
    hasTarget: false,
    casterStats: Object.freeze([])
  });
};

/** Compiles one entry of a stats table; a scaling formula needs the game's stat table. */
const compileEntry = <G extends SpellTypes>(
  value: Scaled<G['stat']>,
  parts: {
    readonly stats: StatTable<G['stat']> | undefined;
    readonly ranks: number;
    readonly what: string;
  }
): CompiledScaled => {
  if (typeof value === 'number') {
    return constantValue(value, parts.what);
  }

  if (parts.stats === undefined) {
    throw new RangeError(`${parts.what}: a scaled stat needs the game's stat table (defineSpells' stats).`);
  }

  return compileScaled(parts.stats, value, { ranks: parts.ranks, what: parts.what });
};

/** Compiles a spell's stats table, or `undefined` when its stats are a function or absent. */
export const compileStats = <G extends SpellTypes>(
  name: string,
  def: AnySpellDef<G>,
  stats: StatTable<G['stat']> | undefined
): CompiledStats | undefined => {
  const table = def.stats;

  if (!isStatsTable<G>(table)) {
    return undefined;
  }

  const keys = Object.keys(table).filter((key) => Object.hasOwn(table, key));
  const ranks = def.ranks ?? 1;

  return Object.freeze({
    keys: Object.freeze(keys),
    values: Object.freeze(
      keys.map((key) => compileEntry<G>(table[key] ?? 0, { stats, ranks, what: `Spell ${name}, ${key}` }))
    )
  });
};

/**
 * A spell's shares of the outgoing multiplier stats, by stat id, NaN for a stat it leaves out (a share of
 * 1); `undefined` when it declares none.
 */
export const compileShares = <G extends SpellTypes>(
  name: string,
  def: AnySpellDef<G>,
  stats: StatTable<G['stat']> | undefined
): Float64Array | undefined => {
  const { scaling } = def;

  if (scaling === undefined) {
    return undefined;
  }

  if (stats === undefined) {
    throw new RangeError(`Spell ${name}: scaling needs the game's stat table (defineSpells' stats).`);
  }

  const shares = new Float64Array(stats.size).fill(Number.NaN);
  const written: Readonly<Record<string, number | undefined>> = scaling;

  for (const [stat, share] of Object.entries(written)) {
    const id = stats.index.idOf(stat);

    if (id === undefined || share === undefined || !Number.isFinite(share)) {
      throw new RangeError(`Spell ${name}: scaling names ${stat}, which must be a stat with a finite share.`);
    }

    shares[id] = share;
  }

  return shares;
};
