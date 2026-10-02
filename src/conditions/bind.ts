// Hot path: a bound condition runs at every read that waits on it, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { compiledOver } from './compile.ts';
import type { CompareOp, CompiledCondition } from './expr.ts';
import type { ConditionTable, ConditionTest } from './table.ts';
import type { ValueRead, ValueTable } from './values.ts';

/** A bound condition: whether it holds for a host, against another unit when the read has one. */
export type Predicate<Host> = (host: Host, against?: Host) => boolean;

/** The tables a condition is bound over: the game's tests and value reads, over its host. */
export interface BoundTables<Host> {
  /** The game's condition tests. */
  readonly conditions?: ConditionTable<string, Host> | undefined;

  /** The game's value kinds. */
  readonly values?: ValueTable<string, Host> | undefined;
}

/**
 * A comparison bound to its read, one closure per op so a read does no dispatch on the op. A NaN read is unequal and
 * unordered: `!=` holds (it is `not` of `==`), every other op does not.
 */
const compareWith = <Host>(
  read: ValueRead<Host>,
  [op, arg, than, epsilon]: readonly [CompareOp, number, number, number]
): Predicate<Host> => {
  switch (op) {
    case '<':
      return (host, against) => read(host, arg, against) < than;
    case '<=':
      return (host, against) => read(host, arg, against) <= than + epsilon;
    case '>':
      return (host, against) => read(host, arg, against) > than;
    case '>=':
      return (host, against) => read(host, arg, against) >= than - epsilon;
    case '==':
      return (host, against) => Math.abs(read(host, arg, against) - than) <= epsilon;
    case '!=':
      return (host, against) => !(Math.abs(read(host, arg, against) - than) <= epsilon);
  }
};

/** Every part holds, tested in order, stopping at the first that does not. */
const allOf =
  <Host>(parts: readonly Predicate<Host>[]): Predicate<Host> =>
  (host, against) => {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]?.(host, against) !== true) {
        return false;
      }
    }

    return true;
  };

/** Some part holds, tested in order, stopping at the first that does. */
const anyOf =
  <Host>(parts: readonly Predicate<Host>[]): Predicate<Host> =>
  (host, against) => {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]?.(host, against) === true) {
        return true;
      }
    }

    return false;
  };

/** Throws when a condition compiled over one of a game's tables is bound over another, whose ids name other entries. */
const checkSame = (table: string, compiled: object | undefined, bound: object | undefined): void => {
  if (compiled !== undefined && bound !== undefined && compiled !== bound) {
    throw new RangeError(
      `A condition compiled over one ${table} table is bound over another; its ids are positions in the first.`
    );
  }
};

/** Throws unless a condition is bound over the tables it was compiled over (one not compiled here is not checked). */
const checkTables = <Host>(tables: BoundTables<Host>, condition: CompiledCondition): void => {
  const over = compiledOver(condition);

  if (over !== undefined) {
    checkSame('conditions', over.conditions, tables.conditions);
    checkSame('values', over.values, tables.values);
  }
};

/** Binds a compiled condition, its tables already checked. */
const bindWith = <Host>(tables: BoundTables<Host>, condition: CompiledCondition): Predicate<Host> => {
  switch (condition.kind) {
    case 'is': {
      const test = (tables.conditions ?? missing('conditions')).get(condition.condition).test;
      const { arg } = condition;

      return (host, against) => test(host, arg, against);
    }
    case 'all':
      return allOf(condition.of.map((part) => bindWith(tables, part)));
    case 'any':
      return anyOf(condition.of.map((part) => bindWith(tables, part)));
    case 'not': {
      const inner = bindWith(tables, condition.of);

      return (host, against) => !inner(host, against);
    }
    case 'against': {
      const inner = bindWith(tables, condition.of);

      return (host, against) => against !== undefined && inner(against, host);
    }
    case 'compare': {
      const { read } = (tables.values ?? missing('values')).get(condition.value);

      return compareWith(read, [condition.op, condition.arg, condition.than, condition.epsilon]);
    }
  }
};

/**
 * Binds a compiled condition to the game's tests and value reads over its host: one closure tree made
 * once, which a read calls with no allocation. Throws when a table it names is missing, or is not the table it was
 * compiled over.
 */
export const bindCondition = <Host>(tables: BoundTables<Host>, condition: CompiledCondition): Predicate<Host> => {
  checkTables(tables, condition);

  return bindWith(tables, condition);
};

/** A condition as a test and the argument it is called with: what a fold entry or a trigger check keeps. */
export interface BoundTest<Host> {
  /** The test. */
  readonly test: ConditionTest<Host>;

  /** Its argument. */
  readonly arg: number;
}

/**
 * A compiled condition as a test and argument pair, the shape a fold entry or a trigger check keeps: a lone
 * game test as itself with its argument, so the common case costs no extra call; anything else as its bound tree.
 */
export const conditionTest = <Host>(tables: BoundTables<Host>, condition: CompiledCondition): BoundTest<Host> => {
  checkTables(tables, condition);

  if (condition.kind === 'is') {
    return {
      test: (tables.conditions ?? missing('conditions')).get(condition.condition).test,
      arg: condition.arg
    };
  }

  const predicate = bindWith(tables, condition);

  return { test: (host, _arg, against) => predicate(host, against), arg: 0 };
};

/** Throws for a table a condition names that the reader was not given. */
const missing = (table: string): never => {
  throw new RangeError(`A condition names ${table}, and the reader has no ${table} table.`);
};
