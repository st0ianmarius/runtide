import { toId } from '../core/ids.ts';
import { type CompiledScaled, compileScaled, evaluateScaled, type Scaled, type StatTable } from '../modifiers/index.ts';

/**
 * What an outcome row does to a blow: `avoid` (a miss, a dodge, a parry: the blow ends `avoided`), `block`
 * (it ends `blocked`), or `scale` (a crit, a glancing blow: its amount is multiplied and it goes on).
 */
export type RollEffect = 'avoid' | 'block' | 'scale';

/** The roll effects, in the order a kind's `unrolled` names them. */
export const ROLL_EFFECTS: readonly RollEffect[] = Object.freeze(['avoid', 'block', 'scale']);

/** One side's stat, read whole: the attacker's (by the blow's spell's share) or the defender's. */
export interface RollStat<S extends string = string> {
  /** The stat. */
  readonly stat: S;

  /** Whose stat it is. */
  readonly of: 'attacker' | 'defender';
}

/** What a row's chance or multiplier is: an attacker's stat by name, one side's stat, or a scaled value of both. */
export type RollValue<S extends string = string> = S | RollStat<S> | Scaled<S>;

/**
 * One outcome row: what it does, its chance, and for a `scale` row the multiplier. Both are
 * scaled values read with the attacker as the caster and the defender as the target (`from: 'target'` terms), the
 * attacker's stats by the blow's spell's shares, as an outgoing multiplier is. A chance is clamped to [0, 1].
 */
export interface RollRow<S extends string = string> {
  /** What it does. */
  readonly effect: RollEffect;

  /**
   * Its chance: an attacker's stat by name (`'critChance'`), one side's stat (`{ stat: 'blockChance', of: 'defender'
   * }`), or a scaled value of both sides. A stat is read directly, with no evaluation.
   */
  readonly chance: RollValue<S>;

  /** The multiplier of a `scale` row, in the same forms (`'critDamage'`, 0.7). */
  readonly multiplier?: RollValue<S>;

  /** Whether it makes the blow critical (`isCrit`, which triggers and cues read). */
  readonly isCrit?: boolean;
}

/**
 * How the rows roll: `single` (WoW's attack table: one draw, the rows in order each taking their chance of it, so an
 * earlier outcome pushes the later ones off the table) or `independent` (League of Legends and swarm: each row draws
 * on its own, in order, an avoid or block ending the blow and a scale applying and going on).
 */
export type RollMode = 'single' | 'independent';

/** A roll table as declared: its mode and its rows, by outcome name, in roll order. */
export interface RollTableSpec<S extends string, O extends string> {
  /** The mode. */
  readonly mode: RollMode;

  /** The rows, by outcome name (`miss`, `dodge`, `parry`, `glancing`, `block`, `crit`, or the game's own). */
  readonly rows: Readonly<Record<O, RollRow<S>>>;
}

/** One row, compiled against the stat table. */
export interface CompiledRollRow {
  /** Its outcome name. */
  readonly outcome: string;

  /** What it does, as its index in `ROLL_EFFECTS`. */
  readonly effect: number;

  /** Its chance. */
  readonly chance: CompiledRollValue;

  /** Its multiplier, for a `scale` row. */
  readonly multiplier: CompiledRollValue | undefined;

  /** Whether it makes the blow critical. */
  readonly isCrit: boolean;
}

/** A row's value, compiled: one side's stat read directly (`stat` from 0), or a scaled value (`stat` −1). */
export interface CompiledRollValue {
  /** The stat read directly, or −1 for a scaled value. */
  readonly stat: number;

  /** Whether that stat is the defender's. */
  readonly isDefender: boolean;

  /** The scaled value, when it is one. */
  readonly scaled: CompiledScaled | undefined;
}

/** A roll table, compiled at load: its mode and its rows in roll order. */
export interface RollTable<O extends string = string> {
  /** The mode. */
  readonly mode: RollMode;

  /** The outcome names, in roll order: what `Blow.outcome` holds and a trigger's `outcome` filter names. */
  readonly names: readonly O[];

  /** The rows. */
  readonly rows: readonly CompiledRollRow[];
}

/**
 * Declares the game's outcome rows: `defineRollTable(STATS, { mode: 'independent', rows: { block: {
 * effect: 'block', chance: scaled(0, add('blockChance', 1, { from: 'target' })) }, crit: { effect: 'scale', chance:
 * 'critChance', multiplier: 'critDamage', isCrit: true } } })`. A plain stat name reads the attacker's stat; every
 * chance and multiplier is compiled and checked at load. At most 32 rows.
 */
export const defineRollTable = <S extends string, const O extends string>(
  stats: StatTable<S>,
  spec: RollTableSpec<NoInfer<S>, O>
): RollTable<O> => {
  const names = Object.keys(spec.rows).filter((key): key is O => Object.hasOwn(spec.rows, key));

  if (spec.mode !== 'single' && spec.mode !== 'independent') {
    throw new RangeError(`A roll table's mode is single or independent; got ${String(spec.mode)}.`);
  }

  if (names.length > 32) {
    throw new RangeError(`A roll table has at most 32 rows; got ${names.length}.`);
  }

  const rows = names.map((name): CompiledRollRow => {
    const row = spec.rows[name];
    const effect = ROLL_EFFECTS.indexOf(row.effect);
    const what = `roll row ${name}`;

    if (effect < 0) {
      throw new RangeError(`${what}: its effect is avoid, block or scale.`);
    }

    if ((row.effect === 'scale') !== (row.multiplier !== undefined)) {
      throw new RangeError(`${what}: a scale row takes a multiplier, and only a scale row does.`);
    }

    const compile = (value: RollValue<S>, part: string): CompiledRollValue =>
      compileValue(stats, value, `${what}, ${part}`);

    return Object.freeze({
      outcome: name,
      effect,
      chance: compile(row.chance, 'chance'),
      multiplier: row.multiplier === undefined ? undefined : compile(row.multiplier, 'multiplier'),
      isCrit: row.isCrit === true
    });
  });

  return Object.freeze({ mode: spec.mode, names: Object.freeze(names), rows: Object.freeze(rows) });
};

/** Compiles a row's value: a stat to read directly, or a scaled value. */
const compileValue = <S extends string>(stats: StatTable<S>, value: RollValue<S>, what: string): CompiledRollValue => {
  if (typeof value === 'number' || (typeof value === 'object' && !('stat' in value))) {
    return { stat: -1, isDefender: false, scaled: compileScaled(stats, value, { what }) };
  }

  const ref: RollStat<S> = typeof value === 'string' ? { stat: value, of: 'attacker' } : value;
  const stat = stats.index.idOf(ref.stat);

  if (stat === undefined) {
    throw new RangeError(`${what}: there is no stat named ${ref.stat}.`);
  }

  return { stat, isDefender: ref.of === 'defender', scaled: undefined };
};

/** The views a row's value reads: the attacker's (by shares) as the caster, the defender's as the target. */
export type RollViewPair = Parameters<typeof evaluateScaled>[1];

/** A row's value for a pair of views. */
export const valueOf = (value: CompiledRollValue, views: RollViewPair): number => {
  if (value.scaled !== undefined) {
    return evaluateScaled(value.scaled, views);
  }

  const view = value.isDefender ? views.target : views.caster;

  return view === undefined ? 0 : view.total(toId<'stats'>(value.stat));
};

/** A row's chance for a pair of views, clamped to [0, 1]. */
export const chanceOf = (row: CompiledRollRow, views: RollViewPair): number =>
  Math.min(1, Math.max(0, valueOf(row.chance, views)));
