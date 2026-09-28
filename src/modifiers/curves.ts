import { createRegistry, type Id, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';
import type { Scaled } from './scaled.ts';

/** The id of a named curve in a game's curve table (`defineCurves`). */
export type CurveId = Id<'curves'>;

/**
 * A curve parameter read from a stat through a piecewise linear table: `byLevel(points)` reads the `level` stat of the
 * caster (in a conversion, the bearer) and looks it up, as WoW's rating per 1% by level does.
 */
export interface Lookup<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'lookup';

  /** The stat whose total is looked up. */
  readonly stat: S;

  /** Whose stat it reads: the caster (the attacker, or the bearer in a conversion) or the target. */
  readonly from: 'caster' | 'target';

  /** The `[x, y]` points, x strictly ascending; below the first and above the last the end values hold. */
  readonly points: readonly (readonly [number, number])[];
}

/** A curve parameter: a number, a scaled value that can read either side (§II.3.13), or a table lookup. */
export type CurveParam<S extends string = string> = Scaled<S> | Lookup<S>;

/** `x × per`: flat conversions. */
export interface LinearCurve<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'linear';

  /** The factor applied to the input. */
  readonly per: CurveParam<S>;
}

/** `x / per / 100`, with `per` the rating for 1%: WoW combat ratings. */
export interface RatingCurve<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'rating';

  /** The rating that gives 1%; it must be above zero. */
  readonly per: CurveParam<S>;
}

/**
 * `x / (x + k)`, capped at `cap`: armor and resistances. At or below zero the result is 0 (`negative: 'zero'`), or with
 * `negative: 'amplify'` the damage multiplier `2 − k / (k − x)` (League of Legends' negative armor), which the damage
 * pipeline applies as a multiplier rather than as a reduction.
 */
export interface HyperbolicCurve<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'hyperbolic';

  /** The rating at which the reduction is one half; it must be above zero. */
  readonly k: CurveParam<S>;

  /** The highest reduction, in `(0, 1]`; `undefined` for none. */
  readonly cap: CurveParam<S> | undefined;

  /** What a rating at or below zero gives: no reduction, or an amplifying damage multiplier. */
  readonly negative: 'zero' | 'amplify';
}

/** `100 / (100 + x)`: League of Legends ability haste, applied to a duration. */
export interface HasteCurve {
  /** The discriminant. */
  readonly kind: 'haste';
}

/** `1 / (1 / cap + k / p)` with `p = x / per / 100`: WoW's diminishing returns on avoidance ratings. */
export interface AvoidanceCurve<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'avoidance';

  /** The rating that gives 1% before diminishing returns; it must be above zero. */
  readonly per: CurveParam<S>;

  /** The asymptote, in `(0, 1]`. */
  readonly cap: CurveParam<S>;

  /** The diminishing constant; it must be above zero. */
  readonly k: CurveParam<S>;
}

/** `1 − (1 − rate)^x`: multiplicative stacking of `x` equal instances (tenacity, slow resistance). */
export interface StackingCurve<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'stacking';

  /** The share one instance removes, in `[0, 1]`. */
  readonly rate: CurveParam<S>;
}

/** Piecewise linear over `[x, y]` points: rating tables and level differences. */
export interface TableCurve {
  /** The discriminant. */
  readonly kind: 'table';

  /** The points, x strictly ascending; below the first and above the last the end values hold. */
  readonly points: readonly (readonly [number, number])[];
}

/** A game's own curve (§I.5.6): a pure, deterministic function of the input. */
export interface CustomCurve {
  /** The discriminant. */
  readonly kind: 'custom';

  /** Maps the input to the effect; it must be pure and deterministic. */
  readonly map: (x: number) => number;
}

/** A curve (§II.3.14): a pure, deterministic function from a number to an effect, as data. */
export type Curve<S extends string = string> =
  | LinearCurve<S>
  | RatingCurve<S>
  | HyperbolicCurve<S>
  | HasteCurve
  | AvoidanceCurve<S>
  | StackingCurve<S>
  | TableCurve
  | CustomCurve;

/** Where a curve is named: a curve object, or the name of one in the game's curve table. */
export type CurveRef<S extends string = string> = Curve<S> | string;

/** `x × per`. */
export const linear = <const S extends string = never>(per: CurveParam<S>): LinearCurve<S> => ({ kind: 'linear', per });

/** `x / per / 100`, with `per` the rating for 1% (a number, a scaled value or `byLevel(points)`). */
export const rating = <const S extends string = never>(per: CurveParam<S>): RatingCurve<S> => ({ kind: 'rating', per });

/** `x / (x + k)` capped at `cap`; `negative` defaults to `'zero'`. */
export const hyperbolic = <const S extends string = never>(options: {
  /** The rating at which the reduction is one half. */
  readonly k: CurveParam<S>;

  /** The highest reduction, in `(0, 1]`. */
  readonly cap?: CurveParam<S>;

  /** What a rating at or below zero gives. */
  readonly negative?: 'zero' | 'amplify';
}): HyperbolicCurve<S> => ({
  kind: 'hyperbolic',
  k: options.k,
  cap: options.cap,
  negative: options.negative ?? 'zero',
});

/** `100 / (100 + x)`. Named `hasteCurve` because `haste(coef)` is the scaled-value helper that applies it. */
export const hasteCurve = (): HasteCurve => ({ kind: 'haste' });

/** `1 / (1 / cap + k / p)` with `p = x / per / 100`. */
export const avoidance = <const S extends string = never>(options: {
  /** The rating for 1% before diminishing returns. */
  readonly per: CurveParam<S>;

  /** The asymptote, in `(0, 1]`. */
  readonly cap: CurveParam<S>;

  /** The diminishing constant. */
  readonly k: CurveParam<S>;
}): AvoidanceCurve<S> => ({ kind: 'avoidance', per: options.per, cap: options.cap, k: options.k });

/** `1 − (1 − rate)^x`. */
export const stacking = <const S extends string = never>(rate: CurveParam<S>): StackingCurve<S> => ({
  kind: 'stacking',
  rate,
});

/** Piecewise linear over `[x, y]` points. */
export const table = (points: readonly (readonly [number, number])[]): TableCurve => ({ kind: 'table', points });

/** A game's own curve from a pure function. */
export const customCurve = (map: (x: number) => number): CustomCurve => ({ kind: 'custom', map });

/** A parameter read from the bearer's `stat` (by default `level`) through a piecewise linear table. */
export const byLevel = <const S extends string = 'level'>(
  points: readonly (readonly [number, number])[],
  options: {
    /** The stat looked up; `level` by default. */
    readonly stat?: S;

    /** Whose stat it reads; the caster by default. */
    readonly from?: 'caster' | 'target';
  } = {},
): Lookup<S | 'level'> => ({ kind: 'lookup', stat: options.stat ?? 'level', from: options.from ?? 'caster', points });

/** The allowed range of a numeric parameter, for the load-time check. */
interface Range {
  /** Whether zero itself is allowed at the low end. */
  readonly isZeroAllowed: boolean;

  /** Whether the value may exceed 1. */
  readonly isUnbounded: boolean;
}

const POSITIVE: Range = { isZeroAllowed: false, isUnbounded: true };
const SHARE: Range = { isZeroAllowed: false, isUnbounded: false };
const RATE: Range = { isZeroAllowed: true, isUnbounded: false };

/** The plain numbers a parameter declares: itself, a scaled value's base (per rank), or a lookup's y values. */
const declaredNumbers = (param: CurveParam | undefined): readonly number[] => {
  if (param === undefined) {
    return [];
  }

  if (typeof param === 'number') {
    return [param];
  }

  if ('kind' in param) {
    return param.points.map(([, y]) => y);
  }

  return typeof param.base === 'number' ? [param.base] : param.base;
};

/** Throws when a parameter's declared numbers are out of its range; a scaled parameter is checked by its base. */
const checkParam = (param: CurveParam | undefined, what: string, range: Range): void => {
  for (const number of declaredNumbers(param)) {
    const isLow = range.isZeroAllowed ? number < 0 : number <= 0;

    if (!Number.isFinite(number) || isLow || (!range.isUnbounded && number > 1)) {
      const bounds = range.isUnbounded ? `${what} > 0` : `${range.isZeroAllowed ? '0 ≤' : '0 <'} ${what} ≤ 1`;

      throw new RangeError(`Curve parameter ${what} is ${number}; it must be finite and ${bounds}.`);
    }
  }
};

/** Throws when table points are empty, not finite or not strictly ascending in x. */
export const checkPoints = (points: readonly (readonly [number, number])[], what: string): void => {
  if (points.length === 0) {
    throw new RangeError(`${what} needs at least one [x, y] point.`);
  }

  for (const [index, [x, y]] of points.entries()) {
    const previous = points[index - 1];

    if (!Number.isFinite(x) || !Number.isFinite(y) || (previous !== undefined && x <= previous[0])) {
      throw new RangeError(`${what}: point ${index} [${x}, ${y}] must be finite with x above the point before.`);
    }
  }
};

/** Checks every plain-number parameter of a curve against its range (`k > 0`, `0 < cap ≤ 1`, …); throws on a mistake. */
export const checkCurve = (curve: Curve): void => {
  switch (curve.kind) {
    case 'linear':
    case 'haste':
    case 'custom': {
      return;
    }

    case 'rating': {
      checkParam(curve.per, 'per', POSITIVE);

      return;
    }

    case 'hyperbolic': {
      checkParam(curve.k, 'k', POSITIVE);
      checkParam(curve.cap, 'cap', SHARE);

      return;
    }

    case 'avoidance': {
      checkParam(curve.per, 'per', POSITIVE);
      checkParam(curve.cap, 'cap', SHARE);
      checkParam(curve.k, 'k', POSITIVE);

      return;
    }

    case 'stacking': {
      checkParam(curve.rate, 'rate', RATE);

      return;
    }

    case 'table': {
      checkPoints(curve.points, 'A table curve');
    }
  }
};

/** A game's named curves: a registry of curve definitions, each checked when the table is built. */
export type CurveTable<Name extends string = string> = Registry<'curves', Extract<Name, string>, Curve, never, never>;

/** Accepts a curve object or a bare function, the latter as a custom curve. */
const toCurve = (def: Curve | ((x: number) => number)): Curve => (typeof def === 'function' ? customCurve(def) : def);

/**
 * Registers the game's named curves (§II.3.13): library curves with their parameters, or plain functions for the
 * game's own (§I.5.6). Stats and scaled values name them (`curve: 'haste'`). Parameters are range-checked here.
 */
export const defineCurves = <const Name extends string>(
  defs: Readonly<Record<Name, Curve | ((x: number) => number)>>,
): CurveTable<Name> => {
  const names = Object.keys(defs).filter((key): key is Name => Object.hasOwn(defs, key));
  const curves = recordOf(names, (name) => toCurve(defs[name]));

  for (const curve of Object.values<Curve>(curves)) {
    checkCurve(curve);
  }

  return createRegistry<Readonly<Record<Name, Curve>>, 'curves'>(curves, { kind: 'curves' });
};

/** The curve table a stat table uses when the game passes none: `haste` alone. */
export const DEFAULT_CURVES: CurveTable<'haste'> = defineCurves({ haste: hasteCurve() });
