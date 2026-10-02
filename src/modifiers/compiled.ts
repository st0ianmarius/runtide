import type { CurveId } from './curves.ts';
import type { StatId } from './stat-id.ts';

/**
 * What a scaled value or a curve reads from one side of a hit: a unit's folded stats. The modifier system's sheets
 * provide one (`system.view`); a snapshot is one too.
 */
export interface StatView {
  /** The stat's folded total. */
  total(stat: StatId): number;

  /** The stat's base, which `of: 'bonus'` subtracts from the total. */
  base(stat: StatId): number;
}

/** What one evaluation reads: the caster's stats, the target's when there is one, and the rank. */
export interface ScaledContext {
  /** The caster (the attacker, or the bearer in a conversion). */
  readonly caster: StatView;

  /** The target; without one, target terms and curves with target-dependent parameters are left out. */
  readonly target?: StatView | undefined;

  /** The rank, from 1; absent, NaN or below 1 reads rank 1, and past the last listed rank reads the last. */
  readonly rank?: number | undefined;
}

/** One compiled stat term: the stat id, its ratio per rank, and which part of which side's stat it reads. */
export interface CompiledTerm {
  /** Which list the term belongs to. */
  readonly op: 'add' | 'amp' | 'curve';

  /** The stat read. */
  readonly stat: StatId;

  /** The ratio at each rank (one entry when it does not vary). */
  readonly coef: Float64Array;

  /** Whether the bonus over the base is read instead of the total. */
  readonly isBonus: boolean;

  /** Whether the target's stat is read instead of the caster's. */
  readonly isTarget: boolean;

  /** The stat's neutral value, which an `amp` term measures its bonus from. */
  readonly neutral: number;
}

/** A scaled value compiled against a stat table: flat term arrays, read with no allocation. */
export interface CompiledScaled {
  /** The discriminant among curve parameters. */
  readonly kind: 'scaled';

  /** The number of ranks its per-rank lists have (1 when none varies). */
  readonly rankCount: number;

  /** The base at each rank. */
  readonly base: Float64Array;

  /** Every term in evaluation order: the `add` terms, then the `amp` terms, then the curve terms. */
  readonly terms: readonly CompiledTerm[];

  /** The curve the curve terms feed, or `undefined` when there is none. */
  readonly curve: CompiledCurve | undefined;

  /** Whether any term, here or in a curve parameter, reads the target. */
  readonly hasTarget: boolean;

  /** Every caster stat read anywhere in the value, curve parameters included, in first-read order. */
  readonly casterStats: readonly StatId[];
}

/** A compiled table lookup parameter (`byLevel`). */
export interface CompiledLookup {
  /** The discriminant among curve parameters. */
  readonly kind: 'lookup';

  /** The stat looked up. */
  readonly stat: StatId;

  /** Whether the target's stat is read instead of the caster's. */
  readonly isTarget: boolean;

  /** The table's x values, strictly ascending. */
  readonly xs: Float64Array;

  /** The table's y values. */
  readonly ys: Float64Array;
}

/** A compiled curve parameter: a number, a compiled scaled value, or a compiled lookup. */
export type CompiledParam = number | CompiledScaled | CompiledLookup;

/** A curve compiled against a stat table, its parameters compiled too. */
export type CompiledCurve =
  | {
      /** The discriminant. */
      readonly kind: 'linear' | 'rating';

      /** The curve's id in the game's table, or `undefined` for an inline curve. */
      readonly id: CurveId | undefined;

      /** The factor (`linear`) or the rating for 1% (`rating`). */
      readonly per: CompiledParam;
    }
  | {
      /** The discriminant. */
      readonly kind: 'hyperbolic';

      /** The curve's id in the game's table, or `undefined` for an inline curve. */
      readonly id: CurveId | undefined;

      /** The half-reduction rating. */
      readonly k: CompiledParam;

      /** The highest reduction, or `undefined` for none. */
      readonly cap: CompiledParam | undefined;

      /** Whether a rating below zero amplifies damage instead of giving 0. */
      readonly isAmplifying: boolean;
    }
  | {
      /** The discriminant. */
      readonly kind: 'stacking';

      /** The curve's id in the game's table, or `undefined` for an inline curve. */
      readonly id: CurveId | undefined;

      /** The share one instance removes. */
      readonly rate: CompiledParam;
    }
  | {
      /** The discriminant. */
      readonly kind: 'table';

      /** The curve's id in the game's table, or `undefined` for an inline curve. */
      readonly id: CurveId | undefined;

      /** The x values, strictly ascending. */
      readonly xs: Float64Array;

      /** The y values. */
      readonly ys: Float64Array;
    }
  | {
      /** The discriminant. */
      readonly kind: 'custom';

      /** The curve's id in the game's table, or `undefined` for an inline curve. */
      readonly id: CurveId | undefined;

      /** The parameter names, in declaration order. */
      readonly names: readonly string[];

      /** The compiled parameters, matching `names`. */
      readonly params: readonly CompiledParam[];

      /** The record `map` receives, refilled with the parameters' values before each call. */
      readonly values: Record<string, number>;

      /** The game's function. */
      readonly map: (x: number, params: Readonly<Record<string, number>>) => number;
    };
