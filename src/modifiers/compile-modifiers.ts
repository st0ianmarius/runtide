import { compileCondition, type ConditionExpr } from '../conditions/index.ts';
import type { Id } from '../core/index.ts';
import type {
  CompiledModifier,
  CompiledValue,
  Modifier,
  ModifierList,
  ModifierTables,
  ModifierValue,
} from './modifier.ts';
import type { StatId } from './stat-id.ts';

/** Where the modifier being compiled sits, for error messages. */
interface Place<S extends string, C extends string, V extends string> {
  readonly tables: ModifierTables<S, C, V>;
  readonly what: string;
}

/** The id of a stat name, or a clear error. */
const statOf = <S extends string>(place: Place<S, string, string>, name: string): StatId => {
  const id = place.tables.stats.index.idOf(name);

  if (id === undefined) {
    throw new RangeError(`${place.what}: there is no stat named ${name}.`);
  }

  return id;
};

/** The id a registry gives a name, or `undefined` for a name it does not have (or no registry). */
const idNamed = <Kind extends string>(
  ids: Readonly<Partial<Record<string, Id<Kind>>>> | undefined,
  name: string,
): Id<Kind> | undefined => (ids !== undefined && Object.hasOwn(ids, name) ? ids[name] : undefined);

/** Throws unless `value` is a number other than NaN (a cap may be infinite). */
const checkNumber = (value: number, place: Place<string, string, string>, field: string): void => {
  if (Number.isNaN(value)) {
    throw new RangeError(`${place.what}: ${field} must be a number.`);
  }
};

/** Compiles a modifier's value. */
const compileValue = <S extends string, C extends string, V extends string>(
  value: ModifierValue<S, V>,
  place: Place<S, C, V>,
): CompiledValue => {
  if (typeof value === 'number') {
    checkNumber(value, place, 'value');

    return value;
  }

  if (value.kind === 'stat') {
    const stat = statOf(place, value.stat);
    const neutral = value.neutral ?? place.tables.stats.index.neutralOf(stat);

    checkNumber(value.per, place, 'per');
    checkNumber(neutral, place, 'neutral');
    checkNumber(value.cap ?? 0, place, 'cap');

    return { kind: 'stat', stat, per: value.per, neutral, cap: value.cap };
  }

  const id = idNamed<'values'>(place.tables.values?.id, value.value);

  if (id === undefined) {
    throw new RangeError(`${place.what}: there is no value kind named ${value.value}.`);
  }

  checkNumber(value.arg, place, 'arg');

  return { kind: 'host', value: id, arg: value.arg };
};

/** Compiles a modifier's condition against the condition and value tables. */
const compileWhen = <S extends string, C extends string, V extends string>(
  when: ConditionExpr<C, V> | undefined,
  place: Place<S, C, V>,
): CompiledModifier['when'] =>
  when === undefined
    ? undefined
    : compileCondition(
        { conditions: place.tables.conditions, values: place.tables.values },
        when,
        `${place.what}, when`,
      );

/** Compiles and checks one modifier. */
const compileModifier = <S extends string, C extends string, V extends string>(
  modifier: Modifier<S, C, V>,
  place: Place<S, C, V>,
): CompiledModifier => {
  const { op, scope, stacking } = modifier;

  if (op !== 'add' && op !== 'mul' && op !== 'min') {
    throw new RangeError(`${place.what}: op must be 'add', 'mul' or 'min'.`);
  }

  if (stacking === 'linear' && op !== 'mul') {
    throw new RangeError(`${place.what}: linear stacking applies to a mul only.`);
  }

  if (scope !== undefined && (!Number.isInteger(scope) || scope < 0)) {
    throw new RangeError(`${place.what}: scope must be a game scope id, a non-negative integer.`);
  }

  return Object.freeze({
    stat: statOf(place, modifier.stat),
    op,
    value: compileValue(modifier.value, place),
    stacking: stacking ?? 'power',
    when: compileWhen(modifier.when, place),
    scope,
  });
};

/**
 * Compiles a list of modifiers against the game's tables, at load (names to ids, every check): an unknown stat,
 * condition or value kind, a NaN, linear stacking on anything but a `mul`, or a bad scope fails here, not in play.
 * `gate` makes the list count only while the host reports stacks of it (an aura id).
 */
export const compileModifiers = <S extends string, C extends string = never, V extends string = never>(
  tables: ModifierTables<S, C, V>,
  modifiers: readonly Modifier<NoInfer<S>, NoInfer<C>, NoInfer<V>>[],
  options: {
    /** The gate the list waits on, or none. */
    readonly gate?: number;

    /** What is being compiled, for error messages. */
    readonly what?: string;
  } = {},
): ModifierList => {
  const { gate } = options;

  if (gate !== undefined && (!Number.isInteger(gate) || gate < 0)) {
    throw new RangeError('A modifier list gate must be a non-negative integer (an aura id).');
  }

  const list = modifiers.map((modifier, index) =>
    compileModifier(modifier, { tables, what: `${options.what ?? 'Modifier list'}, modifier ${index}` }),
  );

  return Object.freeze({ modifiers: Object.freeze(list), gate });
};
