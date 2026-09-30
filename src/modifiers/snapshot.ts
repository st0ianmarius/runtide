import type { CompiledScaled, ScaledContext, StatView } from './compiled.ts';
import { evaluateScaled } from './evaluate.ts';
import type { StatId } from './stat-id.ts';

/**
 * A scaled value with its caster part taken at the cast (decision 2): every caster stat it reads is frozen,
 * and its target terms wait for the hit. `finishScaled` evaluates it against each target in the fixed order, so the
 * result is the float a full evaluation at the cast would give with that target.
 */
export interface ScaledSnapshot {
  /** The compiled value. */
  readonly value: CompiledScaled;

  /** The rank it was taken at. */
  readonly rank: number;

  /** The caster's stats as they were at the cast. */
  readonly caster: StatView;
}

/** A frozen view of the caster stats one value reads; any other stat reads NaN. */
class FrozenView implements StatView {
  readonly totals: Float64Array;
  readonly bases: Float64Array;

  constructor(size: number) {
    this.totals = new Float64Array(size).fill(Number.NaN);
    this.bases = new Float64Array(size).fill(Number.NaN);
  }

  total(stat: StatId): number {
    return this.totals[stat] ?? Number.NaN;
  }

  base(stat: StatId): number {
    return this.bases[stat] ?? Number.NaN;
  }
}

/** The snapshot's own evaluation context, reused by every finish so that finishing allocates nothing. */
class Snapshot implements ScaledSnapshot, ScaledContext {
  readonly value: CompiledScaled;
  rank: number;
  readonly caster: FrozenView;
  target: StatView | undefined = undefined;

  constructor(value: CompiledScaled) {
    this.value = value;
    this.rank = 1;
    this.caster = new FrozenView(Math.max(-1, ...value.casterStats) + 1);
  }
}

/**
 * Takes the caster part of a scaled value: the rank and every caster stat it reads, curve parameters included.
 * Passing a snapshot of the same value as `into` reuses it (for pooled casts); otherwise a new one is made.
 */
export const snapshotScaled = (
  value: CompiledScaled,
  ctx: Pick<ScaledContext, 'caster' | 'rank'>,
  into?: ScaledSnapshot,
): ScaledSnapshot => {
  const snapshot = into instanceof Snapshot && into.value === value ? into : new Snapshot(value);

  snapshot.rank = ctx.rank ?? 1;

  // An indexed loop: every cast start takes this, and an iterator over the frozen list allocates.
  // oxlint-disable-next-line typescript/prefer-for-of
  for (let i = 0; i < value.casterStats.length; i++) {
    const stat = value.casterStats[i];

    if (stat !== undefined) {
      snapshot.caster.totals[stat] = ctx.caster.total(stat);
      snapshot.caster.bases[stat] = ctx.caster.base(stat);
    }
  }

  return snapshot;
};

/**
 * Finishes a snapshot against one target: the full formula in its fixed order, with the frozen caster stats and the
 * target's live ones. Without a target, the target terms are left out. Allocates nothing.
 */
export const finishScaled = (snapshot: ScaledSnapshot, target?: StatView): number => {
  if (!(snapshot instanceof Snapshot)) {
    return evaluateScaled(snapshot.value, { caster: snapshot.caster, target, rank: snapshot.rank });
  }

  snapshot.target = target;

  const result = evaluateScaled(snapshot.value, snapshot);

  snapshot.target = undefined;

  return result;
};
