import { createRegistry, type Registry } from '../core/index.ts';
import {
  compileCurve,
  type CompiledCurve,
  type CurveRef,
  evaluateCurve,
  type ScaledContext,
  type StatId,
  type StatTable,
  type StatView
} from '../modifiers/index.ts';
import type { DamageKindId } from './damage-types.ts';
import type { DamageKindTable } from './kinds.ts';

/** One step of penetration: the attacker's stat taking a share (`percent`) or an amount (`flat`) off the rating. */
export interface Penetration<S extends string = string> {
  /** The discriminant: `percent` multiplies the rating by `1 − stat`, `flat` subtracts the stat. */
  readonly kind: 'percent' | 'flat';

  /** The attacker's stat: a multiplier stat for `percent` (0 is none), a flat stat for `flat`. */
  readonly stat: S;
}

/** A percentage penetration step: the rating times `1 − stat` of the attacker. */
export const percent = <const S extends string>(stat: S): Penetration<S> => ({
  kind: 'percent',
  stat
});

/** A flat penetration step: the rating minus the attacker's stat. */
export const flat = <const S extends string>(stat: S): Penetration<S> => ({ kind: 'flat', stat });

/**
 * One defence of the mitigation rows: a rating the defender holds, lowered by the attacker's penetration in
 * order and turned into a reduction by a curve (`amount × (1 − reduction)`, or the curve's multiplier when an
 * amplifying curve reads a negative rating), or a plain multiplier stat (`amount × stat`), for the blow kinds listed.
 */
export interface MitigationRowDef<S extends string = string, K extends string = string> {
  /** The damage kinds it applies to, or `all`. */
  readonly kinds: readonly K[] | 'all';

  /** The defender's rating stat; it needs a curve. */
  readonly rating?: S;

  /** The attacker's penetration, applied to the rating in order, never taking it below zero. */
  readonly penetration?: readonly Penetration<S>[];

  /** The curve that turns the rating into a reduction; its parameters read the attacker as caster, the defender as target. */
  readonly curve?: CurveRef<S>;

  /** A multiplier stat of the defender the amount is multiplied by (damage taken); instead of a rating. */
  readonly multiplier?: S;
}

/** The game's mitigation rows, in the order the mitigation stage runs them. */
export type MitigationTable<S extends string = string, K extends string = string> = Registry<
  'mitigation',
  string,
  MitigationRowDef<S, K>,
  never
>;

/** Declares the mitigation rows, in order (`defineMitigation({ armor: {…}, taken: {…} })`); checked by the system. */
export const defineMitigation = <const S extends string, const K extends string = never>(
  rows: Readonly<Record<string, MitigationRowDef<S, K>>>
): MitigationTable<S, K> => createRegistry(rows, { kind: 'mitigation' });

/** One penetration step compiled against the stat table. */
interface CompiledPenetration {
  /** Whether it takes a share (`percent`) rather than an amount (`flat`). */
  readonly isPercent: boolean;

  /** The attacker's stat. */
  readonly stat: StatId;
}

/** One row compiled against the stat and kind tables. */
export interface CompiledRow {
  /** Its developer key in the table. */
  readonly key: string;

  /** 1 for each damage kind it applies to, by kind id. */
  readonly kinds: Uint8Array;

  /** The rating stat; `undefined` for a multiplier row. */
  readonly rating: StatId | undefined;

  /** The penetration steps. */
  readonly penetration: readonly CompiledPenetration[];

  /** The compiled curve of a rating row. */
  readonly curve: CompiledCurve | undefined;

  /** The multiplier stat; `undefined` for a rating row. */
  readonly multiplier: StatId | undefined;
}

/** A stat view that reads 0 everywhere: the attacker's side of a blow nobody deals. */
export const NO_STATS: StatView = Object.freeze({ total: () => 0, base: () => 0 });

/**
 * The mutable context the rows read: the two sides' stats for the curves, and the amount being mitigated. One per
 * system, since curve evaluation never nests into the pipeline.
 */
export class RowContext implements ScaledContext {
  caster: StatView = NO_STATS;
  target: StatView = NO_STATS;
  amount = 0;
  readonly rank = 1;
}

/** Throws a load-time error about one row. */
const refuse = (name: string, problem: string): never => {
  throw new RangeError(`Mitigation row ${name}: ${problem}`);
};

/** The id of a stat, checked for kind. */
const statOf = <S extends string>(stats: StatTable<S>, name: S, want: { row: string; isMultiplier: boolean }) => {
  const id = stats.index.idOf(name);

  if (id === undefined) {
    return refuse(want.row, `there is no stat ${name}.`);
  }

  if (stats.index.isMultiplier(id) !== want.isMultiplier) {
    refuse(want.row, `${name} must be a ${want.isMultiplier ? 'multiplier' : 'flat'} stat.`);
  }

  return id;
};

/** Which kinds a row covers. */
const kindsOf = <K extends string>(kinds: DamageKindTable<K>, def: MitigationRowDef<string, K>, row: string) => {
  const covered = new Uint8Array(kinds.size);

  if (def.kinds === 'all') {
    return covered.fill(1);
  }

  const ids: Readonly<Record<string, DamageKindId | undefined>> = kinds.id;

  for (const kind of def.kinds) {
    covered[ids[kind] ?? refuse(row, `there is no damage kind ${kind}.`)] = 1;
  }

  return covered;
};

/** Compiles one row. */
const compileRow = <S extends string, K extends string>(
  tables: { readonly stats: StatTable<S>; readonly kinds: DamageKindTable<K> },
  name: string,
  def: MitigationRowDef<S, K>
): CompiledRow => {
  const { stats } = tables;
  const isRating = def.rating !== undefined;

  if (isRating === (def.multiplier !== undefined) || isRating !== (def.curve !== undefined)) {
    refuse(name, 'a row has a rating and a curve, or a multiplier, not both.');
  }

  if (!isRating && (def.penetration?.length ?? 0) > 0) {
    refuse(name, 'penetration needs a rating.');
  }

  return {
    key: name,
    kinds: kindsOf(tables.kinds, def, name),
    rating: def.rating === undefined ? undefined : statOf(stats, def.rating, { row: name, isMultiplier: false }),

    penetration: (def.penetration ?? []).map((step) => ({
      isPercent: step.kind === 'percent',
      stat: statOf(stats, step.stat, { row: name, isMultiplier: step.kind === 'percent' })
    })),

    curve: def.curve === undefined ? undefined : compileCurve(stats, def.curve, { what: `Mitigation row ${name}` }),
    multiplier:
      def.multiplier === undefined ? undefined : statOf(stats, def.multiplier, { row: name, isMultiplier: true })
  };
};

/**
 * Compiles the rows against the game's tables and checks them: every stat known and of the right kind,
 * curve parameters in range, and every damage kind that does not skip mitigation covered by at least one row.
 */
export const compileMitigation = <S extends string, K extends string>(
  table: MitigationTable<S, K>,
  tables: {
    readonly stats: StatTable<S>;
    readonly kinds: DamageKindTable<K>;
    readonly skips: (kind: number) => boolean;
  }
): readonly CompiledRow[] => {
  const rows = table.ids.map((id) => compileRow(tables, table.name(id), table.get(id)));

  for (const kind of tables.kinds.ids) {
    if (!tables.skips(kind) && !rows.some((row) => row.kinds[kind] === 1)) {
      throw new RangeError(`Damage kind ${tables.kinds.name(kind)} is covered by no mitigation row.`);
    }
  }

  return Object.freeze(rows);
};

/** The rating of a row after the attacker's penetration, in order: a positive rating never goes below zero. */
export const penetrated = (row: CompiledRow, ctx: RowContext): number => {
  let rating = row.rating === undefined ? 0 : ctx.target.total(row.rating);

  for (let i = 0; i < row.penetration.length && rating > 0; i++) {
    const step = row.penetration[i];

    if (step !== undefined) {
      const value = ctx.caster.total(step.stat);

      rating = step.isPercent ? rating * (1 - value) : rating - value;
      rating = Math.max(rating, 0);
    }
  }

  return rating;
};

/** Whether a row's curve turns a negative rating into a multiplier rather than a reduction. */
export const isAmplifyingAt = (row: CompiledRow, rating: number): boolean =>
  rating < 0 && row.curve?.kind === 'hyperbolic' && row.curve.isAmplifying;

/**
 * The factor one row multiplies the amount by: `1 − reduction`, the amplifying multiplier, or its stat; never below 0,
 * so a reduction past 100% (a linear or rating curve, a negative multiplier stat) takes it all, and no row turns a
 * blow's sign.
 */
export const rowFactor = (row: CompiledRow, ctx: RowContext): number => {
  if (row.curve === undefined) {
    return row.multiplier === undefined ? 1 : Math.max(0, ctx.target.total(row.multiplier));
  }

  const rating = penetrated(row, ctx);
  const value = evaluateCurve(row.curve, rating, ctx);

  return Math.max(0, isAmplifyingAt(row, rating) ? value : 1 - value);
};
