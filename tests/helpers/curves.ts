import { type CurveParam, type CustomCurve, customCurve, defineCurves } from '../../src/modifiers/index.ts';

/** League of Legends' ability haste, as a game writes it: `100 / (100 + x)` on a duration, a slow below zero. */
export const HASTE = customCurve((x) => (x >= 0 ? 100 / (100 + x) : 1 - x / 100));

/** WoW's diminishing returns on avoidance ratings, as a game writes it: `1 / (1 / cap + k / p)`, `p = x / per / 100`. */
export const avoidance = <const S extends string = never>(params: {
  readonly per: CurveParam<S>;
  readonly cap: CurveParam<S>;
  readonly k: CurveParam<S>;
}): CustomCurve<S> =>
  customCurve((x, { per, cap, k }) => {
    const percent = x / per / 100;

    return percent <= 0 ? 0 : 1 / (1 / cap + k / percent);
  }, params);

/** The test games' curve table: haste alone. */
export const CURVES = defineCurves({ haste: HASTE });
