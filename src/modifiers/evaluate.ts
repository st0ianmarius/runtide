// Hot path (§I.4.2, §I.5.4): indexed loops, which allocate no iterator.
/* oxlint-disable typescript/prefer-for-of */
import type {
  CompiledCurve,
  CompiledParam,
  CompiledScaled,
  CompiledTerm,
  ScaledContext,
  StatView,
} from './compiled.ts';

/**
 * The share-of-1 rule (§II.3.13): a share of a multiplier stat's bonus, `1 + share × (M − neutral)`, except that a
 * share of exactly 1 of a stat whose neutral is 1 reads the stat as it is, since `1 + 1 × (M − 1)` can differ from `M`
 * in the last bit. A share of 0 ignores the stat. The damage pipeline's outgoing multipliers and `amp` terms use it.
 */
export const shareOf = (multiplier: number, share: number, neutral = 1): number =>
  share === 1 && neutral === 1 ? multiplier : 1 + share * (multiplier - neutral);

/** The 0-based slot of a 1-based rank in lists of `rankCount` entries, clamped to the lists. */
export const rankSlot = (rankCount: number, rank: number | undefined): number => {
  if (rank === undefined || rank <= 1) {
    return 0;
  }

  return Math.min(Math.trunc(rank), rankCount) - 1;
};

/** The index of the first x at or above `x`, for an `x` strictly inside the table's range. */
const segmentEnd = (xs: Float64Array, x: number): number => {
  let high = 1;

  while ((xs[high] ?? Infinity) < x) {
    high += 1;
  }

  return high;
};

/** Piecewise linear interpolation over ascending `xs`; below the first and above the last x the end values hold. */
export const tableAt = (xs: Float64Array, ys: Float64Array, x: number): number => {
  const last = xs.length - 1;

  if (x <= (xs[0] ?? 0)) {
    return ys[0] ?? 0;
  }

  if (x >= (xs[last] ?? 0)) {
    return ys[last] ?? 0;
  }

  const high = segmentEnd(xs, x);
  const x0 = xs[high - 1] ?? 0;
  const y0 = ys[high - 1] ?? 0;

  return y0 + (((ys[high] ?? 0) - y0) * (x - x0)) / ((xs[high] ?? 0) - x0);
};

/** What one term reads: the stat's total, or its bonus over the base, on the caster or the target. */
const readTerm = (term: CompiledTerm, view: StatView): number => {
  const total = view.total(term.stat);

  return term.isBonus ? total - view.base(term.stat) : total;
};

/** A value's curve at the summed input, or exactly 1 when it has none (`x × 1` is `x` to the bit). */
const curveFactor = (value: CompiledScaled, input: number, ctx: ScaledContext): number =>
  value.curve === undefined ? 1 : evaluateCurve(value.curve, input, ctx);

/**
 * Evaluates a compiled scaled value: `(base + Σ add) × Π amp × curve(Σ curve terms)`, each sum and product in the
 * order written, at the context's rank. Without a target in the context, target terms are left out. Allocates nothing.
 */
export const evaluateScaled = (value: CompiledScaled, ctx: ScaledContext): number => {
  const slot = rankSlot(value.rankCount, ctx.rank);
  let result = value.base[slot] ?? 0;
  let input = 0;

  const { terms } = value;

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const view = term?.isTarget === true ? ctx.target : ctx.caster;

    if (term !== undefined && view !== undefined) {
      const coef = term.coef[slot] ?? 0;
      const read = readTerm(term, view);

      if (term.op === 'add') {
        result += coef * read;
      } else if (term.op === 'amp') {
        result *= shareOf(read, coef, term.neutral);
      } else {
        input += coef * read;
      }
    }
  }

  return result * curveFactor(value, input, ctx);
};

/** Evaluates a curve parameter: a number as is, a scaled value, or a lookup through its table. */
const paramValue = (param: CompiledParam, ctx: ScaledContext): number => {
  if (typeof param === 'number') {
    return param;
  }

  if (param.kind === 'scaled') {
    return evaluateScaled(param, ctx);
  }

  const view = param.isTarget ? ctx.target : ctx.caster;

  if (view === undefined) {
    throw new RangeError('A curve parameter looks up a target stat, but the evaluation has no target.');
  }

  return tableAt(param.xs, param.ys, view.total(param.stat));
};

/** `x / (x + k)` capped; at or below zero 0, or below zero the amplifying multiplier `2 − k / (k − x)`. */
const hyperbolicAt = (curve: Extract<CompiledCurve, { kind: 'hyperbolic' }>, x: number, ctx: ScaledContext): number => {
  const k = paramValue(curve.k, ctx);

  if (x <= 0) {
    return curve.isAmplifying && x < 0 ? 2 - k / (k - x) : 0;
  }

  const reduction = x / (x + k);

  if (curve.cap === undefined) {
    return reduction;
  }

  const cap = paramValue(curve.cap, ctx);

  return reduction > cap ? cap : reduction;
};

/** `1 / (1 / cap + k / p)` with `p = x / per / 100`; 0 at or below zero. */
const avoidanceAt = (curve: Extract<CompiledCurve, { kind: 'avoidance' }>, x: number, ctx: ScaledContext): number => {
  const percent = x / paramValue(curve.per, ctx) / 100;

  if (percent <= 0) {
    return 0;
  }

  return 1 / (1 / paramValue(curve.cap, ctx) + paramValue(curve.k, ctx) / percent);
};

/**
 * Evaluates a compiled curve at `x` (§II.3.14). Parameters that are scaled values or lookups read the context's caster
 * and target. For a `hyperbolic` curve that amplifies, a negative `x` gives a damage multiplier rather than a
 * reduction; every other result is the curve's formula as written.
 */
export const evaluateCurve = (curve: CompiledCurve, x: number, ctx: ScaledContext): number => {
  switch (curve.kind) {
    case 'linear': {
      return x * paramValue(curve.per, ctx);
    }

    case 'rating': {
      return x / paramValue(curve.per, ctx) / 100;
    }

    case 'hyperbolic': {
      return hyperbolicAt(curve, x, ctx);
    }

    case 'haste': {
      return 100 / (100 + x);
    }

    case 'avoidance': {
      return avoidanceAt(curve, x, ctx);
    }

    case 'stacking': {
      return 1 - (1 - paramValue(curve.rate, ctx)) ** x;
    }

    case 'table': {
      return tableAt(curve.xs, curve.ys, x);
    }

    case 'custom': {
      return curve.map(x);
    }
  }
};
