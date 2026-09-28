/**
 * Modifiers (§I.6, §II.3.13, §II.3.14): the stat table with flat and multiplier stats, derived stats and rating
 * conversions; modifiers, game conditions and value kinds, sources in fold order and the fold with its caps, cached per
 * bearer; structured explanations; the curve library; and scaled values with their evaluation, snapshots and
 * explanations.
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

export { compileModifiers } from './compile-modifiers.ts';
export { compileCurve, type CompileOptions, compileScaled } from './compile-values.ts';

export {
  type ConditionDef,
  type ConditionId,
  type ConditionTable,
  type ConditionTest,
  defineConditions,
} from './conditions.ts';

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

export {
  type Contribution,
  type DerivedContribution,
  explainModifier,
  explainModifiers,
  type ModifierExplanation,
  type StatExplanation,
} from './explain.ts';

export { explainScaled, type ScaledExplanation, type TermExplanation } from './explain-scaled.ts';

export {
  cap,
  type CompiledModifier,
  type CompiledValue,
  type Condition,
  type HostValue,
  hostValue,
  type Modifier,
  type ModifierList,
  type ModifierOptions,
  type ModifierTables,
  type ModifierValue,
  mul,
  perStat,
  plus,
  type StatValue,
} from './modifier.ts';

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

export type { FoldRead, StatSheet } from './sheet.ts';
export { finishScaled, type ScaledSnapshot, snapshotScaled } from './snapshot.ts';
export { defineSources, MAX_SOURCES, type SourceDef, type SourceId, sourceMask, type SourceTable } from './sources.ts';
export type { NamedCurve, StatId, StatIndex } from './stat-id.ts';

export {
  defineStats,
  type Derivation,
  type GainMeasure,
  type GainParts,
  type StatDef,
  type StatTable,
} from './stats.ts';

export { createModifierSystem, type ModifierSystem, type ModifierSystemOptions } from './system.ts';
export { defineValues, type ValueDef, type ValueId, type ValueRead, type ValueTable } from './values.ts';
export { type StatChange, type StatWatch, watchStats } from './watch.ts';
