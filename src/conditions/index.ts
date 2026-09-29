/**
 * Conditions (§I.7.1 F12, §II.6 M3, M8): one data-driven predicate system that modifiers, triggers, targeting and AI
 * all read. The game registers its tests (`defineConditions`) and value kinds (`defineValues`); a condition names them
 * (`{ is }`, `{ value, op, than }`) and composes them (`all`, `any`, `not`); it is compiled at load
 * (`compileCondition`) and bound to a host once (`bindCondition`).
 */

export { bindCondition, type BoundTables, type BoundTest, conditionTest, type Predicate } from './bind.ts';
export { compileCondition, type ConditionTables, isMirrorSafe, readsWorld } from './compile.ts';

export {
  all,
  type AllCondition,
  any,
  type AnyCondition,
  type CompareCondition,
  type CompareOp,
  type CompiledCondition,
  type ConditionExpr,
  type IsCondition,
  not,
  type NotCondition,
} from './expr.ts';

export {
  type ConditionDef,
  type ConditionId,
  type ConditionSpec,
  type ConditionTable,
  type ConditionTest,
  defineConditions,
} from './table.ts';

export {
  defineValues,
  type ValueDef,
  type ValueId,
  type ValueRead,
  type ValueSpec,
  type ValueTable,
} from './values.ts';
