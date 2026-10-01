import type { ConditionId } from './table.ts';
import type { ValueId } from './values.ts';

/** A game condition by name, with its numeric argument (0 when absent): `{ is: 'healthBelow', arg: 0.4 }`. */
export interface IsCondition<C extends string = string> {
  /** The game condition tested. */
  readonly is: C;

  /** Its numeric argument (a health share, a tag id); 0 when absent. */
  readonly arg?: number;
}

/** Every one of its conditions holds (an empty list is refused). */
export interface AllCondition<C extends string = string, V extends string = string> {
  /** The conditions. */
  readonly all: readonly ConditionExpr<C, V>[];
}

/** At least one of its conditions holds (an empty list is refused). */
export interface AnyCondition<C extends string = string, V extends string = string> {
  /** The conditions. */
  readonly any: readonly ConditionExpr<C, V>[];
}

/** Its condition does not hold. */
export interface NotCondition<C extends string = string, V extends string = string> {
  /** The condition negated. */
  readonly not: ConditionExpr<C, V>;
}

/**
 * Its condition holds for the unit the read is against, asked as that unit's own (its tests and values read it as the
 * host, with the read's host as theirs to be against): `against({ is: 'elite' })`. It does not hold when the read is
 * against no unit.
 */
export interface AgainstCondition<C extends string = string, V extends string = string> {
  /** The condition asked of the other unit. */
  readonly against: ConditionExpr<C, V>;
}

/**
 * How a comparison compares a value with its threshold: `<` and `>` are strict; `<=` and `>=` admit the
 * epsilon (`v ≤ than + ε`, `v ≥ than − ε`); `==` and `!=` compare within it (`|v − than| ≤ ε`).
 */
export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

/** A game value kind's read compared with a threshold: `{ value: 'healthShare', op: '<=', than: 0.5 }`. */
export interface CompareCondition<V extends string = string> {
  /** The value kind read. */
  readonly value: V;

  /** The read's numeric argument; 0 when absent. */
  readonly arg?: number;

  /** How it compares. */
  readonly op: CompareOp;

  /** The threshold. */
  readonly than: number;

  /** The epsilon of `<=`, `>=`, `==` and `!=`, from 0; 0 when absent. */
  readonly epsilon?: number;
}

/**
 * A condition: one data-driven predicate that modifiers, triggers, targeting and AI all read, as
 * game tests (`is`), comparisons of game values (`value`), and their composition (`all`, `any`, `not`, and
 * `against`, which asks the unit the read is against).
 */
export type ConditionExpr<C extends string = string, V extends string = string> =
  | IsCondition<C>
  | AllCondition<C, V>
  | AnyCondition<C, V>
  | NotCondition<C, V>
  | AgainstCondition<C, V>
  | CompareCondition<V>;

/**
 * A condition compiled at load: names resolved to ids, numbers checked, and in `all` and `any` the parts that
 * ask the world moved after those that do not. It is data, so it is also its own explanation.
 */
export type CompiledCondition =
  | {
      /** A game test. */
      readonly kind: 'is';

      /** The condition. */
      readonly condition: ConditionId;

      /** Its argument. */
      readonly arg: number;
    }
  | {
      /** A composition. */
      readonly kind: 'all' | 'any';

      /** Its parts, world-reading ones last. */
      readonly of: readonly CompiledCondition[];
    }
  | {
      /** A negation, or a condition asked of the unit the read is against. */
      readonly kind: 'not' | 'against';

      /** What it negates, or asks of the other unit. */
      readonly of: CompiledCondition;
    }
  | {
      /** A comparison. */
      readonly kind: 'compare';

      /** The value kind. */
      readonly value: ValueId;

      /** The read's argument. */
      readonly arg: number;

      /** How it compares. */
      readonly op: CompareOp;

      /** The threshold. */
      readonly than: number;

      /** The epsilon. */
      readonly epsilon: number;
    };

/** `all(a, b, …)`: every one holds. */
export const all = <C extends string, V extends string = never>(
  ...conditions: readonly ConditionExpr<C, V>[]
): AllCondition<C, V> => ({ all: conditions });

/** `any(a, b, …)`: at least one holds. */
export const any = <C extends string, V extends string = never>(
  ...conditions: readonly ConditionExpr<C, V>[]
): AnyCondition<C, V> => ({ any: conditions });

/** `not(a)`: it does not hold. */
export const not = <C extends string, V extends string = never>(
  condition: ConditionExpr<C, V>
): NotCondition<C, V> => ({
  not: condition
});

/** `against(a)`: it holds for the unit the read is against (a blow's target); never when there is none. */
export const against = <C extends string, V extends string = never>(
  condition: ConditionExpr<C, V>
): AgainstCondition<C, V> => ({
  against: condition
});
