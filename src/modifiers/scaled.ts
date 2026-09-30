import type { CurveRef } from './curves.ts';

/** One ratio, or one per rank (`ranks(0.5, 0.6, 0.7)`). */
export type PerRank = number | readonly number[];

/**
 * One stat term of a scaled value: `coef × stat`. `of: 'bonus'` reads the stat minus its base ("+60% bonus
 * attack damage"); `from: 'target'` reads the target's stat when the value lands, not the caster's at the cast.
 */
export interface Term<S extends string = string> {
  /** The stat read. */
  readonly stat: S;

  /** The ratio, one number or one per rank. */
  readonly coef: PerRank;

  /** Whether the stat's total or its bonus over its base is read; `total` when absent. */
  readonly of?: 'total' | 'bonus';

  /** Whose stat is read; `caster` when absent. */
  readonly from?: 'caster' | 'target';
}

/** A curve term: as `Term`, except that `stat` may be left out to mean the stat that declares the curve. */
export interface CurveTerm<S extends string = string> {
  /** The stat read; when absent, the one stat whose definition declares this curve (`abilityHaste` for `haste`). */
  readonly stat?: S;

  /** The ratio, one number or one per rank. */
  readonly coef: PerRank;

  /** Whether the stat's total or its bonus over its base is read; `total` when absent. */
  readonly of?: 'total' | 'bonus';

  /** Whose stat is read; `caster` when absent. */
  readonly from?: 'caster' | 'target';
}

/**
 * A number written as data, always evaluated as `(base + Σ add) × Π amp × curve(Σ curve terms)`, in that
 * fixed order, so the float result is the same everywhere.
 */
export interface Scaling<S extends string = string> {
  /** The base, one number or one per rank (`ranks(60, 95, 130)`). */
  readonly base: PerRank;

  /** Terms summed onto the base, in order: `+ coef × stat`, on flat stats. */
  readonly add?: readonly Term<S>[];

  /** Factors applied in order: `× (1 + coef × (stat − neutral))`, on multiplier stats (a share of 1 reads the stat). */
  readonly amp?: readonly Term<S>[];

  /** A curve of the summed terms, applied last: `× curve(Σ coef × stat)`. */
  readonly curve?: {
    /** The curve applied. */
    readonly kind: CurveRef<S>;

    /** The terms summed into the curve's input, in order. */
    readonly by: readonly CurveTerm<S>[];
  };
}

/** A scaled value: a plain number, or a scaling formula over stats. */
export type Scaled<S extends string = string> = number | Scaling<S>;

/** One part of a scaled value as the helpers build it; `scaled(base, ...parts)` sorts them into their lists. */
export type ScalingPart<S extends string = string> =
  | {
      /** Which list the term joins. */
      readonly part: 'add' | 'amp';

      /** The term. */
      readonly term: Term<S>;
    }
  | {
      /** Which list the term joins. */
      readonly part: 'curve';

      /** The curve the term feeds. */
      readonly curve: CurveRef<S>;

      /** The term. */
      readonly term: CurveTerm<S>;
    };

/** Options of a stat term: which part of the stat, and whose. */
export interface TermOptions {
  /** Whether the stat's total or its bonus over its base is read; `total` by default. */
  readonly of?: 'total' | 'bonus';

  /** Whose stat is read; `caster` by default. */
  readonly from?: 'caster' | 'target';
}

/** A per-rank list: `ranks(60, 95, 130)` is 60 at rank 1, 95 at rank 2 and 130 at rank 3. */
export const ranks = (...values: readonly number[]): readonly number[] => {
  if (values.length === 0) {
    throw new RangeError('ranks() needs at least one value.');
  }

  return Object.freeze([...values]);
};

/** Builds a term, leaving out the options that are absent (so the term has no `undefined` fields). */
const termOf = <S extends string>(stat: S, coef: PerRank, options: TermOptions): Term<S> => ({
  stat,
  coef,
  ...(options.of === undefined ? {} : { of: options.of }),
  ...(options.from === undefined ? {} : { from: options.from }),
});

/** `+ coef × stat` on a flat stat: `add('attackDamage', 1.2)`, `add('maxHealth', 0.08, { from: 'target' })`. */
export const add = <const S extends string>(stat: S, coef: PerRank, options: TermOptions = {}): ScalingPart<S> => ({
  part: 'add',
  term: termOf(stat, coef, options),
});

/** `× (1 + coef × (stat − neutral))` on a multiplier stat: `amp('damage', 1.1)` takes 110% of the damage bonus. */
export const amp = <const S extends string>(stat: S, coef: PerRank, options: TermOptions = {}): ScalingPart<S> => ({
  part: 'amp',
  term: termOf(stat, coef, options),
});

/** `× curve(Σ coef × stat)`: `curveOf('haste', 0.5)`; without `stat`, the stat that declares the curve is read. */
export const curveOf = <const S extends string = never>(
  curve: CurveRef<S>,
  coef: PerRank,
  options: TermOptions & {
    /** The stat read; by default the one whose definition declares the curve. */
    readonly stat?: S;
  } = {},
): ScalingPart<S> => ({
  part: 'curve',
  curve,
  term: {
    coef,
    ...(options.stat === undefined ? {} : { stat: options.stat }),
    ...(options.of === undefined ? {} : { of: options.of }),
    ...(options.from === undefined ? {} : { from: options.from }),
  },
});

/** `× 100 / (100 + coef × haste)`: `scaled(12, haste(0.5))` is a 12 s cooldown taking half the ability haste. */
export const haste = (coef: PerRank): ScalingPart<never> => curveOf('haste', coef);

/** Appends a curve part, refusing a second curve: a scaled value has one curve at most. */
const withCurve = <S extends string>(
  current: Scaling<S>['curve'],
  part: Extract<ScalingPart<S>, { part: 'curve' }>,
): NonNullable<Scaling<S>['curve']> => {
  if (current !== undefined && current.kind !== part.curve) {
    throw new RangeError('A scaled value takes one curve at most; its curve parts name two different curves.');
  }

  return { kind: part.curve, by: [...(current?.by ?? []), part.term] };
};

/**
 * A scaled value from a base and parts, sorted into `add`, `amp` and `curve` in the order given:
 * `scaled(ranks(60, 95, 130), add('attackDamage', 1.2), add('abilityPower', 0.5))`.
 */
export const scaled = <const S extends string = never>(
  base: PerRank,
  ...parts: readonly ScalingPart<S>[]
): Scaling<S> => {
  const adds: Term<S>[] = [];
  const amps: Term<S>[] = [];
  let curve: Scaling<S>['curve'];

  for (const part of parts) {
    if (part.part === 'curve') {
      curve = withCurve(curve, part);
    } else {
      (part.part === 'add' ? adds : amps).push(part.term);
    }
  }

  return {
    base,
    ...(adds.length > 0 ? { add: adds } : {}),
    ...(amps.length > 0 ? { amp: amps } : {}),
    ...(curve === undefined ? {} : { curve }),
  };
};
