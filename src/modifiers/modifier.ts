import type { CompiledCondition, ConditionExpr, ConditionTable, ValueId, ValueTable } from '../conditions/index.ts';
import type { StatId } from './stat-id.ts';
import type { StatTable } from './stats.ts';

/**
 * A value that follows another stat: `per × (total(stat) − neutral)`, capped at `cap`, with the other
 * stat folded for the same read (same scope, same sources).
 */
export interface StatValue<S extends string = string> {
  /** The discriminant. */
  readonly kind: 'stat';

  /** The stat followed. */
  readonly stat: S;

  /** The share of its bonus taken. */
  readonly per: number;

  /** What the bonus is measured from; the stat's own neutral value when absent. */
  readonly neutral?: number;

  /** The highest value it lands with, before stacking; none when absent. */
  readonly cap?: number;
}

/** A value read from the bearer's state through a game value kind, still data for explanations. */
export interface HostValue<V extends string = string> {
  /** The discriminant. */
  readonly kind: 'host';

  /** The game value kind that reads it. */
  readonly value: V;

  /** The kind's numeric argument. */
  readonly arg: number;
}

/** What a modifier lands with: a number, another stat's bonus, or a game value read. */
export type ModifierValue<S extends string = string, V extends string = string> = number | StatValue<S> | HostValue<V>;

/**
 * One change to one stat: `add` sums onto the base, `mul` multiplies the sum, `min` caps the product. A stat
 * resolves as `clamp(min((base + Σ add + derived) × Π mul, …caps))`, multipliers in source order.
 */
export interface Modifier<S extends string = string, C extends string = string, V extends string = string> {
  /** The stat changed. */
  readonly stat: S;

  /** How it changes the stat. */
  readonly op: 'add' | 'mul' | 'min';

  /** What it lands with at one stack. */
  readonly value: ModifierValue<S, V>;

  /**
   * How a gated `mul` stacks: `value ^ stacks` (`power`, the default) or `1 + (value − 1) × stacks`
   * (`linear`). An `add` always lands `value × stacks`, and a `min` is the same at any stack count.
   */
  readonly stacking?: 'power' | 'linear';

  /** When it counts (a game test, a comparison, or their composition); always when absent. */
  readonly when?: ConditionExpr<C, V>;

  /** The scope it reaches (a game scope id: a tag, a spell); unscoped, reaching every read, when absent. */
  readonly scope?: number;
}

/** Options shared by the modifier helpers. */
export interface ModifierOptions<C extends string = string, V extends string = never> {
  /** When it counts. */
  readonly when?: ConditionExpr<C, V>;

  /** The scope it reaches. */
  readonly scope?: number;

  /** How a gated `mul` stacks. */
  readonly stacking?: 'power' | 'linear';
}

/** Builds a modifier with only the options that are present. */
const modifierOf = <S extends string, C extends string, V extends string>(
  head: Pick<Modifier<S, C, V>, 'stat' | 'op' | 'value'>,
  options: ModifierOptions<C, V>,
): Modifier<S, C, V> => ({
  ...head,
  ...(options.when === undefined ? {} : { when: options.when }),
  ...(options.scope === undefined ? {} : { scope: options.scope }),
  ...(options.stacking === undefined ? {} : { stacking: options.stacking }),
});

/** An `add` modifier. Named `plus` because `add` is the scaled-value term helper. */
export const plus = <const S extends string, const V extends string = never, const C extends string = never>(
  stat: S,
  value: ModifierValue<S, V>,
  options: ModifierOptions<C, V> = {},
): Modifier<S, C, V> => modifierOf({ stat, op: 'add', value }, options);

/** A `mul` modifier: `mul('moveSpeed', 1.2)`. */
export const mul = <const S extends string, const V extends string = never, const C extends string = never>(
  stat: S,
  value: ModifierValue<S, V>,
  options: ModifierOptions<C, V> = {},
): Modifier<S, C, V> => modifierOf({ stat, op: 'mul', value }, options);

/** A `min` modifier: the stat is capped at `value`, after every multiplier. */
export const cap = <const S extends string, const V extends string = never, const C extends string = never>(
  stat: S,
  value: ModifierValue<S, V>,
  options: ModifierOptions<C, V> = {},
): Modifier<S, C, V> => modifierOf({ stat, op: 'min', value }, options);

/** A value that follows another stat's bonus: `per × (total(stat) − neutral)`, capped. */
export const perStat = <const S extends string>(
  stat: S,
  per: number,
  options: {
    /** What the bonus is measured from; the stat's neutral value by default. */
    readonly neutral?: number;

    /** The highest value it lands with. */
    readonly cap?: number;
  } = {},
): StatValue<S> => ({
  kind: 'stat',
  stat,
  per,
  ...(options.neutral === undefined ? {} : { neutral: options.neutral }),
  ...(options.cap === undefined ? {} : { cap: options.cap }),
});

/** A value read from the bearer through a game value kind: `hostValue('missingHealth', 0.5)`. */
export const hostValue = <const V extends string>(value: V, arg = 0): HostValue<V> => ({ kind: 'host', value, arg });

/** A compiled value: a number, or a stat-valued or host-valued one with its names resolved to ids. */
export type CompiledValue =
  | number
  | {
      /** The discriminant. */
      readonly kind: 'stat';

      /** The stat followed. */
      readonly stat: StatId;

      /** The share of its bonus taken. */
      readonly per: number;

      /** What the bonus is measured from. */
      readonly neutral: number;

      /** The highest value it lands with, or `undefined` for none. */
      readonly cap: number | undefined;
    }
  | {
      /** The discriminant. */
      readonly kind: 'host';

      /** The game value kind. */
      readonly value: ValueId;

      /** Its argument. */
      readonly arg: number;
    };

/** A modifier compiled against the game's tables: every name resolved to its id, every option present. */
export interface CompiledModifier {
  /** The stat changed. */
  readonly stat: StatId;

  /** How it changes the stat. */
  readonly op: 'add' | 'mul' | 'min';

  /** What it lands with at one stack. */
  readonly value: CompiledValue;

  /** How it stacks when gated. */
  readonly stacking: 'power' | 'linear';

  /** When it counts, compiled, or `undefined` for always. */
  readonly when: CompiledCondition | undefined;

  /** The scope it reaches, or `undefined` for every read. */
  readonly scope: number | undefined;
}

/**
 * A compiled list of modifiers, the unit a source holds (a pact's list, an aura's list). With a `gate` (an aura id),
 * the list counts only while the host reports stacks of it, scaled by those stacks.
 */
export interface ModifierList {
  /** The compiled modifiers, in authored order. */
  readonly modifiers: readonly CompiledModifier[];

  /** The gate the list waits on (an aura id), or `undefined` for a list that always counts. */
  readonly gate: number | undefined;
}

/** The tables a modifier is compiled against. */
export interface ModifierTables<S extends string, C extends string, V extends string> {
  /** The game's stat table. */
  readonly stats: StatTable<S>;

  /** The game's condition table, if it has conditions. */
  readonly conditions?: ConditionTable<C> | undefined;

  /** The game's value kinds, if it has any. */
  readonly values?: ValueTable<V> | undefined;
}
