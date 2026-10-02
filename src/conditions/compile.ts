import type { Id } from '../core/index.ts';
import { ownValue } from '../core/records.ts';
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

/** The ops that take an epsilon. */
const EPSILON_OPS: readonly string[] = ['<=', '>=', '==', '!='];

/** The keys each shape of condition may carry, by the key that names the shape. */
const SHAPES: ReadonlyMap<string, readonly string[]> = new Map([
  ['is', ['is', 'arg']],
  ['all', ['all']],
  ['any', ['any']],
  ['not', ['not']],
  ['against', ['against']],
  ['value', ['value', 'arg', 'op', 'than', 'epsilon']]
]);

/** The tables each compiled condition was compiled over, kept beside it so that the condition stays plain data. */
const compiledOn = new WeakMap<CompiledCondition, ConditionTables>();

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
const finite = (state: Compiling, value: unknown, field: string): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : refuse(state, `a condition's ${field} must be a finite number; got ${String(value)}.`);

/** A name, or a refusal naming the field. */
const named = (state: Compiling, value: unknown, field: string): string =>
  typeof value === 'string' ? value : refuse(state, `a condition's ${field} must be a name; got ${String(value)}.`);

/** What a value that is not a condition is, for a message. */
const kindOf = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  return Array.isArray(value) ? 'a list' : typeof value;
};

/**
 * The key that names a condition's shape (`is`, `value`, `all`, `any`, `not` or `against`), refusing anything but an
 * object with exactly one of them and no key that shape does not take: `{ is, value }` is not read as a comparison, nor
 * `{ all, not }` as a list, nor a misspelt `args` as no argument.
 */
const shapeOf = (state: Compiling, expr: unknown): string => {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) {
    return refuse(state, `a condition must be an object; got ${kindOf(expr)}.`);
  }

  const keys = Object.keys(expr);
  const shapes = keys.filter((key) => SHAPES.has(key));
  const [shape] = shapes;

  if (shape === undefined || shapes.length > 1) {
    refuse(
      state,
      `a condition has exactly one of the keys ${[...SHAPES.keys()].join(' ')}; got ${shapes.join(' ') || 'none'}.`
    );
  }

  const allowed = SHAPES.get(shape ?? '') ?? [];
  const unknown = keys.filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    refuse(state, `a condition's keys with ${shape} are ${allowed.join(' ')}; got also ${unknown.join(' ')}.`);
  }

  return shape ?? '';
};

/** A condition's argument, from 0 when absent; when present, it must be a finite number. */
const argOf = (state: Compiling, expr: { readonly arg?: unknown }): number =>
  'arg' in expr ? finite(state, expr.arg, 'arg') : 0;

/** A comparison's epsilon, 0 when absent; only an op that takes one may carry it, and it is from 0. */
const epsilonOf = (state: Compiling, expr: Extract<ConditionExpr, { readonly value: string }>): number => {
  if (!('epsilon' in expr)) {
    return 0;
  }

  if (!EPSILON_OPS.includes(expr.op)) {
    refuse(state, `a comparison's epsilon is taken by ${EPSILON_OPS.join(' ')} only; got it with ${expr.op}.`);
  }

  const epsilon = finite(state, expr.epsilon, 'epsilon');

  return epsilon < 0 ? refuse(state, `a comparison's epsilon is from 0; got ${epsilon}.`) : epsilon;
};

/**
 * The tables a compiled condition was compiled over, so that binding it over another game's tables, whose ids name
 * other entries, is refused; `undefined` for a condition not made by `compileCondition`.
 */
export const compiledOver = (condition: CompiledCondition): ConditionTables | undefined => compiledOn.get(condition);

/** The id of a name in a registry's ids, or `undefined`. */
const idIn = <Kind extends string>(
  ids: Readonly<Record<string, Id<Kind> | undefined>> | undefined,
  name: string
): Id<Kind> | undefined => ownValue(ids, name);

/** Whether a compiled condition asks the world anywhere in it. */
export const readsWorld = (tables: ConditionTables, condition: CompiledCondition): boolean => {
  switch (condition.kind) {
    case 'is':
      return tables.conditions?.get(condition.condition).isWorld === true;
    case 'all':
    case 'any':
      return condition.of.some((part) => readsWorld(tables, part));
    case 'not':
    case 'against':
      return readsWorld(tables, condition.of);
    case 'compare':
      return false;
  }
};

/**
 * Whether a prediction mirror may evaluate a compiled condition: every test and value in it is flagged
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
    case 'against':
      return isMirrorSafe(tables, condition.of);
    case 'compare':
      return tables.values?.get(condition.value).isMirrorSafe === true;
  }
};

/** Compiles a list's parts, the ones that ask the world moved after the rest, each group in authored order. */
const compileParts = (state: Compiling, parts: readonly ConditionExpr[], kind: 'all' | 'any'): CompiledCondition => {
  if (!Array.isArray(parts)) {
    refuse(state, `an ${kind} condition's parts must be a list; got ${kindOf(parts)}.`);
  }

  if (parts.length === 0) {
    refuse(state, `an ${kind} condition needs at least one part.`);
  }

  const compiled = parts.map((part) => compileWith(state, part));
  const world = compiled.map((part) => readsWorld(state.tables, part));

  return Object.freeze({
    kind,
    of: Object.freeze([...compiled.filter((_part, i) => world[i] !== true), ...compiled.filter((_part, i) => world[i])])
  });
};

/** Compiles a comparison. */
const compileCompare = (
  state: Compiling,
  expr: Extract<ConditionExpr, { readonly value: string }>
): CompiledCondition => {
  const name = named(state, expr.value, 'value');
  const value = idIn<'values'>(state.tables.values?.id, name) ?? refuse(state, `there is no value kind named ${name}.`);

  if (!OPS.includes(expr.op)) {
    refuse(state, `a comparison's op is one of ${OPS.join(' ')}; got ${String(expr.op)}.`);
  }

  return Object.freeze({
    kind: 'compare',
    value,
    arg: argOf(state, expr),
    op: expr.op,
    than: finite(state, expr.than, 'than'),
    epsilon: epsilonOf(state, expr)
  });
};

/** Compiles one condition of a checked shape. */
const compileShape = (state: Compiling, expr: ConditionExpr): CompiledCondition => {
  if ('all' in expr) {
    return compileParts(state, expr.all, 'all');
  }

  if ('any' in expr) {
    return compileParts(state, expr.any, 'any');
  }

  if ('not' in expr) {
    return Object.freeze({ kind: 'not', of: compileWith(state, expr.not) });
  }

  if ('against' in expr) {
    return Object.freeze({ kind: 'against', of: compileWith(state, expr.against) });
  }

  if ('value' in expr) {
    return compileCompare(state, expr);
  }

  const name = named(state, expr.is, 'is');

  const condition =
    idIn<'conditions'>(state.tables.conditions?.id, name) ?? refuse(state, `there is no condition named ${name}.`);

  return Object.freeze({ kind: 'is', condition, arg: argOf(state, expr) });
};

/** Compiles one condition, after checking its shape, and keeps the tables it was compiled over beside it. */
const compileWith = (state: Compiling, expr: ConditionExpr): CompiledCondition => {
  shapeOf(state, expr);

  const compiled = compileShape(state, expr);

  compiledOn.set(compiled, state.tables);

  return compiled;
};

/**
 * Compiles a condition against the game's tables at load: every condition an object of one shape with only the keys
 * that shape takes, every name a registered condition or value kind, every number finite, every list a non-empty list,
 * an epsilon only on an op that takes one; and in `all` and `any` the parts that ask the world are moved after the
 * rest, which changes no result, since conditions are pure. The result may be bound only over the tables it was
 * compiled over. Throws a `RangeError` naming `what`.
 */
export const compileCondition = <C extends string, V extends string>(
  tables: ConditionTables<C, V>,
  expr: ConditionExpr<C, V>,
  what = 'condition'
): CompiledCondition => compileWith({ tables, what }, expr);
