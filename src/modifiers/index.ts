/**
 * Modifiers (§I.6, §II.3.13, §II.3.14): the stat table with flat and multiplier stats, derived stats and rating
 * conversions; the curve library; and scaled values with their evaluation, snapshots and explanations.
 */

export type {
  CompiledCurve,
  CompiledLookup,
  CompiledParam,
  CompiledScaled,
  CompiledTerm,
  ScaledContext,
  StatView,
} from './compiled.ts';

export { compileCurve, type CompileOptions, compileScaled } from './compile-values.ts';

export {
  avoidance,
  type AvoidanceCurve,
  byLevel,
  checkCurve,
  type Curve,
  type CurveId,
  type CurveParam,
  type CurveRef,
  type CurveTable,
  type CustomCurve,
  customCurve,
  DEFAULT_CURVES,
  defineCurves,
  type HasteCurve,
  hasteCurve,
  hyperbolic,
  type HyperbolicCurve,
  linear,
  type LinearCurve,
  type Lookup,
  rating,
  type RatingCurve,
  stacking,
  type StackingCurve,
  table,
  type TableCurve,
} from './curves.ts';

export { evaluateCurve, evaluateScaled, rankSlot, shareOf, tableAt } from './evaluate.ts';

export { explainScaled, type ScaledExplanation, type TermExplanation } from './explain-scaled.ts';

export {
  add,
  amp,
  curveOf,
  type CurveTerm,
  haste,
  type PerRank,
  ranks,
  type Scaled,
  scaled,
  type Scaling,
  type ScalingPart,
  type Term,
  type TermOptions,
} from './scaled.ts';

export { finishScaled, type ScaledSnapshot, snapshotScaled } from './snapshot.ts';
export type { NamedCurve, StatId, StatIndex } from './stat-id.ts';
export { defineStats, type Derivation, type StatDef, type StatTable } from './stats.ts';
