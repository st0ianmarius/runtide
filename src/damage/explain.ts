import type { StatView } from '../modifiers/index.ts';
import type { DamageKindId } from './damage-types.ts';
import { type CompiledRow, isAmplifyingAt, penetrated, RowContext, rowFactor } from './mitigation.ts';

/** One mitigation row as data (§II.3.14, §I.5.3), for the client to phrase ("Armor 120: 54.5% less damage"). */
export interface MitigationRowExplanation {
  /** The row's developer name. */
  readonly row: string;

  /** Whether it is a rating through a curve or a plain multiplier stat. */
  readonly kind: 'rating' | 'multiplier';

  /** The defender's rating (a rating row), or the multiplier stat's value. */
  readonly value: number;

  /** The rating after the attacker's penetration (a rating row), or the value again. */
  readonly penetrated: number;

  /** Whether the curve amplifies the blow here (a negative rating on an amplifying curve). */
  readonly isAmplifying: boolean;

  /** The factor the row multiplies the amount by: `1 − reduction`, the amplifying multiplier, or the stat. */
  readonly factor: number;
}

/** The mitigation a blow of one kind meets, as data. */
export interface MitigationExplanation {
  /** The damage kind. */
  readonly kind: DamageKindId;

  /** Every row that covers the kind, in order. */
  readonly rows: readonly MitigationRowExplanation[];

  /** The product of the rows' factors, in order: what a blow of 1 comes out as. */
  readonly factor: number;
}

/** Explains the rows covering a kind for an attacker's and a defender's stats. */
export const explainRows = (
  rows: readonly CompiledRow[],
  query: { readonly kind: DamageKindId; readonly caster: StatView; readonly target: StatView },
): MitigationExplanation => {
  const ctx = new RowContext();

  ctx.caster = query.caster;
  ctx.target = query.target;

  const explained = rows
    .filter((row) => row.kinds[query.kind] === 1)
    .map((row): MitigationRowExplanation => {
      const isRating = row.curve !== undefined;
      const stat = isRating ? row.rating : row.multiplier;
      const value = stat === undefined ? 0 : ctx.target.total(stat);
      const after = isRating ? penetrated(row, ctx) : value;

      return {
        row: row.key,
        kind: isRating ? 'rating' : 'multiplier',
        value,
        penetrated: after,
        isAmplifying: isRating && isAmplifyingAt(row, after),
        factor: rowFactor(row, ctx),
      };
    });

  return {
    kind: query.kind,
    rows: explained,
    factor: explained.reduce((product, row) => product * row.factor, 1),
  };
};
