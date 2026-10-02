import type { CompiledScaled, CompiledTerm, ScaledContext } from './compiled.ts';
import type { CurveId } from './curves.ts';
import { evaluateScaled, rankSlot } from './evaluate.ts';
import type { StatId } from './stat-id.ts';

/** One term of a scaled value, explained: what it reads, at which ratio, and the reading when there is one. */
export interface TermExplanation {
  /** Which list the term belongs to. */
  readonly op: 'add' | 'amp' | 'curve';

  /** The stat read. */
  readonly stat: StatId;

  /** The ratio at the explained rank. */
  readonly coef: number;

  /** Whether the stat's total or its bonus over its base is read. */
  readonly of: 'total' | 'bonus';

  /** Whose stat is read. */
  readonly from: 'caster' | 'target';

  /** The stat as read (after `of`), or `undefined` when that side was not given (a target term in a preview). */
  readonly value: number | undefined;
}

/**
 * A scaled value explained as data: the client prints "60 (+120% AD) (+50% AP)" from it in its own words.
 * Nothing here is text.
 */
export interface ScaledExplanation {
  /** The discriminant. */
  readonly kind: 'scaled';

  /** The rank explained, clamped to the value's lists. */
  readonly rank: number;

  /** The base at that rank. */
  readonly base: number;

  /** Every term, in evaluation order. */
  readonly terms: readonly TermExplanation[];

  /** The curve applied last: its kind and its id in the game's table (`undefined` for an inline one), if any. */
  readonly curve:
    | {
        /** The curve's kind. */
        readonly kind: NonNullable<CompiledScaled['curve']>['kind'];

        /** Its id in the game's curve table, or `undefined` for an inline curve. */
        readonly id: CurveId | undefined;
      }
    | undefined;

  /** The evaluated value when stats were given, or `undefined` for a ratio-only explanation. */
  readonly total: number | undefined;

  /** Whether target terms or a curve with target-dependent parameters were left out of `total`. */
  readonly isPartial: boolean;
}

/** Explains one term at a rank slot, reading it when its side is given. */
const explainTerm = (term: CompiledTerm, slot: number, ctx: ScaledContext | undefined): TermExplanation => {
  const view = term.isTarget ? ctx?.target : ctx?.caster;
  const total = view?.total(term.stat);

  const value = total !== undefined && view !== undefined && term.isBonus ? total - view.base(term.stat) : total;

  return {
    op: term.op,
    stat: term.stat,
    coef: term.coef[slot] ?? 0,
    of: term.isBonus ? 'bonus' : 'total',
    from: term.isTarget ? 'target' : 'caster',
    value
  };
};

/**
 * Explains a scaled value at a rank: its base, each term with its ratio, and, when `ctx` gives the
 * caster's stats (and the target's), each reading and the total. With no `ctx` it is a ratio-only preview.
 */
export const explainScaled = (
  value: CompiledScaled,
  rank = 1,
  ctx?: Omit<ScaledContext, 'rank'>
): ScaledExplanation => {
  const slot = rankSlot(value.rankCount, rank);
  const isPartial = ctx !== undefined && ctx.target === undefined && value.hasTarget;

  return {
    kind: 'scaled',
    rank: slot + 1,
    base: value.base[slot] ?? 0,
    terms: value.terms.map((term) => explainTerm(term, slot, ctx)),
    curve: value.curve === undefined ? undefined : { kind: value.curve.kind, id: value.curve.id },
    total: ctx === undefined ? undefined : evaluateScaled(value, { ...ctx, rank }),
    isPartial
  };
};
