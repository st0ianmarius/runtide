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

/** A curve parameter: a number, a scaled value that can read either side, or a table lookup. */
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

/**
 * A game's own curve: a pure, deterministic function of the input and of its parameters. The parameters are curve
 * parameters like the library curves' (numbers, scaled values, lookups), so they can read either side of a hit and
 * snapshots see the stats they read; `map` receives their values by name.
 */
export interface CustomCurve<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'custom';

  /** The named parameters `map` receives, evaluated for each call. */
  readonly params: Readonly<Record<string, CurveParam<S>>>;

  /**
   * Maps the input to the effect; it must be pure and deterministic. The parameter record is reused between calls,
   * so read it during the call and do not keep it.
   */
  readonly map: (x: number, params: Readonly<Record<string, number>>) => number;
}

/** A curve: a pure, deterministic function from a number to an effect, as data. */
export type Curve<S extends string = string> =
  | LinearCurve<S>
  | RatingCurve<S>
  | HyperbolicCurve<S>
  | StackingCurve<S>
  | TableCurve
  | CustomCurve<S>;

/** Where a curve is named: a curve object, or the name of one in the game's curve table. */
export type CurveRef<S extends string = string> = Curve<S> | string;

/** `x × per`. */
export const linear = <const S extends string = never>(per: CurveParam<S>): LinearCurve<S> => ({
  kind: 'linear',
  per
});

/** `x / per / 100`, with `per` the rating for 1% (a number, a scaled value or `byLevel(points)`). */
export const rating = <const S extends string = never>(per: CurveParam<S>): RatingCurve<S> => ({
  kind: 'rating',
  per
});

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
  negative: options.negative ?? 'zero'
});

/** `1 − (1 − rate)^x`. */
export const stacking = <const S extends string = never>(rate: CurveParam<S>): StackingCurve<S> => ({
  kind: 'stacking',
  rate
});

/** Piecewise linear over `[x, y]` points. */
export const table = (points: readonly (readonly [number, number])[]): TableCurve => ({
  kind: 'table',
  points
});

/**
 * A game's own curve: `customCurve((x) => 100 / (100 + x))`, or with parameters the framework evaluates and passes by
 * name, `customCurve((x, { k }) => x / (x + k), { k: byLevel(ARMOR_K) })`.
 */
export const customCurve = <const P extends string = never, const S extends string = never>(
  map: (x: number, params: Readonly<Record<P, number>>) => number,
  params?: Readonly<Record<P, CurveParam<S>>>
): CustomCurve<S> => ({ kind: 'custom', params: params ?? {}, map });

/** A parameter read from the bearer's `stat` (by default `level`) through a piecewise linear table. */
export const byLevel = <const S extends string = 'level'>(
  points: readonly (readonly [number, number])[],
  options: {
    /** The stat looked up; `level` by default. */
    readonly stat?: S;

    /** Whose stat it reads; the caster by default. */
    readonly from?: 'caster' | 'target';
  } = {}
): Lookup<S | 'level'> => ({
  kind: 'lookup',
  stat: options.stat ?? 'level',
  from: options.from ?? 'caster',
  points
});

/** The allowed range of a numeric parameter, for the load-time check. */
interface Range {
  /** Whether any finite number is allowed, a custom curve's parameters being the game's to check. */
  readonly isAny: boolean;

  /** Whether zero itself is allowed at the low end. */
  readonly isZeroAllowed: boolean;

  /** Whether the value may exceed 1. */
  readonly isUnbounded: boolean;
}

const ANY: Range = { isAny: true, isZeroAllowed: true, isUnbounded: true };
const POSITIVE: Range = { isAny: false, isZeroAllowed: false, isUnbounded: true };
const SHARE: Range = { isAny: false, isZeroAllowed: false, isUnbounded: false };
const RATE: Range = { isAny: false, isZeroAllowed: true, isUnbounded: false };

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
    const isLow = !range.isAny && (range.isZeroAllowed ? number < 0 : number <= 0);

    if (!Number.isFinite(number) || isLow || (!range.isUnbounded && number > 1)) {
      const bounds = range.isUnbounded ? `${what} > 0` : `${range.isZeroAllowed ? '0 ≤' : '0 <'} ${what} ≤ 1`;
      const must = range.isAny ? 'finite' : `finite and ${bounds}`;

      throw new RangeError(`Curve parameter ${what} is ${number}; it must be ${must}.`);
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
    case 'linear': {
      return;
    }

    case 'custom': {
      for (const [name, param] of Object.entries<CurveParam>(curve.params)) {
        checkParam(param, name, ANY);
      }

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
export type CurveTable<Name extends string = string> = Registry<'curves', Extract<Name, string>, Curve, never>;

/** Accepts a curve object or a bare function, the latter as a custom curve. */
const toCurve = (def: Curve | ((x: number) => number)): Curve => (typeof def === 'function' ? customCurve(def) : def);

/**
 * Registers the game's named curves: library curves with their parameters, or the game's own (`customCurve`, or a
 * plain function). Stats and scaled values name them (`curve: 'haste'`). Parameters are range-checked here.
 */
export const defineCurves = <const Name extends string>(
  defs: Readonly<Record<Name, Curve | ((x: number) => number)>>
): CurveTable<Name> => {
  const names = Object.keys(defs).filter((key): key is Name => Object.hasOwn(defs, key));
  const curves = recordOf(names, (name) => toCurve(defs[name]));

  for (const curve of Object.values<Curve>(curves)) {
    checkCurve(curve);
  }

  return createRegistry<Readonly<Record<Name, Curve>>, 'curves'>(curves, { kind: 'curves' });
};

/** The curve table a stat table uses when the game passes none: empty. */
export const NO_CURVES: CurveTable<never> = defineCurves({});
