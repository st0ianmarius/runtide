import type { Id } from '../core/index.ts';
import type { CompiledCondition, ConditionExpr } from './expr.ts';
import type { ConditionTable } from './table.ts';
import type { ValueTable } from './values.ts';

/**
 * The tables a condition is compiled against: any game's (a table over a host is one, whatever the host, since only
 * its names and flags are read here).
 */
export interface ConditionTables<C extends string = string, V extends string = string> {
  /** The game's condition tests, when it names any. */
  readonly conditions?: ConditionTable<C> | undefined;

  /** The game's value kinds, when it compares any. */
  readonly values?: ValueTable<V> | undefined;
}

/** The ops a comparison may use. */
const OPS: readonly string[] = ['<', '<=', '>', '>=', '==', '!='];

/** The compile state: the tables and what is being compiled, for messages. */
interface Compiling {
  readonly tables: ConditionTables;
  readonly what: string;
}

/** Throws a `RangeError` naming what is being compiled. */
const refuse = (state: Compiling, problem: string): never => {
  throw new RangeError(`${state.what}: ${problem}`);
};

/** A finite number, or a refusal naming the field. */
const finite = (state: Compiling, value: number, field: string): number =>
  Number.isFinite(value) ? value : refuse(state, `a condition's ${field} must be a finite number; got ${value}.`);

/** The id of a name in a registry's ids, or `undefined`. */
const idIn = <Kind extends string>(
  ids: Readonly<Record<string, Id<Kind> | undefined>> | undefined,
  name: string,
): Id<Kind> | undefined => ids?.[name];

/** Whether a compiled condition asks the world anywhere in it. */
export const readsWorld = (tables: ConditionTables, condition: CompiledCondition): boolean => {
  switch (condition.kind) {
    case 'is':
      return tables.conditions?.get(condition.condition).isWorld === true;
    case 'all':
    case 'any':
      return condition.of.some((part) => readsWorld(tables, part));
    case 'not':
      return readsWorld(tables, condition.of);
    case 'compare':
      return false;
  }
};

/**
 * Whether a prediction mirror may evaluate a compiled condition (§II.6 M8, R3): every test and value in it is flagged
 * `mirrorSafe`.
 */
export const isMirrorSafe = (tables: ConditionTables, condition: CompiledCondition): boolean => {
  switch (condition.kind) {
    case 'is':
      return tables.conditions?.get(condition.condition).isMirrorSafe === true;
    case 'all':
    case 'any':
      return condition.of.every((part) => isMirrorSafe(tables, part));
    case 'not':
      return isMirrorSafe(tables, condition.of);
    case 'compare':
      return tables.values?.get(condition.value).isMirrorSafe === true;
  }
};

/** Compiles a list's parts, the ones that ask the world moved after the rest, each group in authored order. */
const compileParts = (state: Compiling, parts: readonly ConditionExpr[], kind: 'all' | 'any'): CompiledCondition => {
  if (parts.length === 0) {
    refuse(state, `an ${kind} condition needs at least one part.`);
  }

  const compiled = parts.map((part) => compileWith(state, part));
  const world = compiled.map((part) => readsWorld(state.tables, part));

  return Object.freeze({
    kind,
    of: Object.freeze([
      ...compiled.filter((_part, i) => world[i] !== true),
      ...compiled.filter((_part, i) => world[i]),
    ]),
  });
};

/** Compiles a comparison. */
const compileCompare = (
  state: Compiling,
  expr: Extract<ConditionExpr, { readonly value: string }>,
): CompiledCondition => {
  const value =
    idIn<'values'>(state.tables.values?.id, expr.value) ?? refuse(state, `there is no value kind named ${expr.value}.`);

  if (!OPS.includes(expr.op)) {
    refuse(state, `a comparison's op is one of ${OPS.join(' ')}; got ${String(expr.op)}.`);
  }

  const epsilon = finite(state, expr.epsilon ?? 0, 'epsilon');

  if (epsilon < 0) {
    refuse(state, `a comparison's epsilon is from 0; got ${epsilon}.`);
  }

  return Object.freeze({
    kind: 'compare',
    value,
    arg: finite(state, expr.arg ?? 0, 'arg'),
    op: expr.op,
    than: finite(state, expr.than, 'than'),
    epsilon,
  });
};

/** Compiles one condition. */
const compileWith = (state: Compiling, expr: ConditionExpr): CompiledCondition => {
  if ('all' in expr) {
    return compileParts(state, expr.all, 'all');
  }

  if ('any' in expr) {
    return compileParts(state, expr.any, 'any');
  }

  if ('not' in expr) {
    return Object.freeze({ kind: 'not', of: compileWith(state, expr.not) });
  }

  if ('value' in expr) {
    return compileCompare(state, expr);
  }

  const condition =
    idIn<'conditions'>(state.tables.conditions?.id, expr.is) ??
    refuse(state, `there is no condition named ${expr.is}.`);

  return Object.freeze({ kind: 'is', condition, arg: finite(state, expr.arg ?? 0, 'arg') });
};

/**
 * Compiles a condition against the game's tables at load (§I.7.1 F12): every name must be a registered condition or
 * value kind, every number finite, every list non-empty, and in `all` and `any` the parts that ask the world are moved
 * after the rest, which changes no result, since conditions are pure. Throws a `RangeError` naming `what`.
 */
export const compileCondition = <C extends string, V extends string>(
  tables: ConditionTables<C, V>,
  expr: ConditionExpr<C, V>,
  what = 'condition',
): CompiledCondition => compileWith({ tables, what }, expr);
