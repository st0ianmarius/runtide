// Hot path (§I.5.4): a bound condition runs at every read that waits on it, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { CompareOp, CompiledCondition } from './expr.ts';
import type { ConditionTable, ConditionTest } from './table.ts';
import type { ValueRead, ValueTable } from './values.ts';

/** A bound condition: whether it holds for a host. */
export type Predicate<Host> = (host: Host) => boolean;

/** The tables a condition is bound over: the game's tests and value reads, over its host. */
export interface BoundTables<Host> {
  /** The game's condition tests. */
  readonly conditions?: ConditionTable<string, Host> | undefined;

  /** The game's value kinds. */
  readonly values?: ValueTable<string, Host> | undefined;
}

/** A comparison bound to its read, one closure per op so a read does no dispatch on the op. */
const compareWith = <Host>(
  read: ValueRead<Host>,
  [op, arg, than, epsilon]: readonly [CompareOp, number, number, number],
): Predicate<Host> => {
  switch (op) {
    case '<':
      return (host) => read(host, arg) < than;
    case '<=':
      return (host) => read(host, arg) <= than + epsilon;
    case '>':
      return (host) => read(host, arg) > than;
    case '>=':
      return (host) => read(host, arg) >= than - epsilon;
    case '==':
      return (host) => Math.abs(read(host, arg) - than) <= epsilon;
    case '!=':
      return (host) => Math.abs(read(host, arg) - than) > epsilon;
  }
};

/** Every part holds, tested in order, stopping at the first that does not. */
const allOf =
  <Host>(parts: readonly Predicate<Host>[]): Predicate<Host> =>
  (host) => {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]?.(host) !== true) {
        return false;
      }
    }

    return true;
  };

/** Some part holds, tested in order, stopping at the first that does. */
const anyOf =
  <Host>(parts: readonly Predicate<Host>[]): Predicate<Host> =>
  (host) => {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]?.(host) === true) {
        return true;
      }
    }

    return false;
  };

/**
 * Binds a compiled condition to the game's tests and value reads over its host (§I.7.1 F12): one closure tree made
 * once, which a read calls with no allocation. Throws when a table it names is missing.
 */
export const bindCondition = <Host>(tables: BoundTables<Host>, condition: CompiledCondition): Predicate<Host> => {
  switch (condition.kind) {
    case 'is': {
      const test = (tables.conditions ?? missing('conditions')).get(condition.condition).test;
      const { arg } = condition;

      return (host) => test(host, arg);
    }
    case 'all':
      return allOf(condition.of.map((part) => bindCondition(tables, part)));
    case 'any':
      return anyOf(condition.of.map((part) => bindCondition(tables, part)));
    case 'not': {
      const inner = bindCondition(tables, condition.of);

      return (host) => !inner(host);
    }
    case 'compare': {
      const { read } = (tables.values ?? missing('values')).get(condition.value);

      return compareWith(read, [condition.op, condition.arg, condition.than, condition.epsilon]);
    }
  }
};

/** A condition as a test and the argument it is called with: what a fold entry or a trigger check keeps. */
export interface BoundTest<Host> {
  /** The test. */
  readonly test: ConditionTest<Host>;

  /** Its argument. */
  readonly arg: number;
}

/**
 * A compiled condition as a test and argument pair, the shape a fold entry or a trigger check keeps (§I.5.4): a lone
 * game test as itself with its argument, so the common case costs no extra call; anything else as its bound tree.
 */
export const conditionTest = <Host>(tables: BoundTables<Host>, condition: CompiledCondition): BoundTest<Host> => {
  if (condition.kind === 'is') {
    return { test: (tables.conditions ?? missing('conditions')).get(condition.condition).test, arg: condition.arg };
  }

  const predicate = bindCondition(tables, condition);

  return { test: (host) => predicate(host), arg: 0 };
};

/** Throws for a table a condition names that the reader was not given. */
const missing = (table: string): never => {
  throw new RangeError(`A condition names ${table}, and the reader has no ${table} table.`);
};
