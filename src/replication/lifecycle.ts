import type { AuraView } from '../auras/index.ts';

/**
 * What happened to one aura between two views of its bearer, as a client derives it at zero bytes (§II.6 A7, R4):
 * `applied`, `refreshed` (its clock was set again), `stacked` (its stacks changed), `changed` (its value changed),
 * `expired` (it left when its end stamp had come) or `removed` (it left before).
 */
export type AuraLifecycle = 'applied' | 'refreshed' | 'stacked' | 'changed' | 'expired' | 'removed';

/** One aura instance's change between two views. */
export interface AuraViewChange {
  /** The aura. */
  readonly aura: AuraView['aura'];

  /** The instance. */
  readonly serial: number;

  /** What happened. */
  readonly change: AuraLifecycle;
}

/**
 * What happened to one aura instance between two views (`undefined` for none): gone with its end stamp reached on
 * `clocks` (the bearer's steps per clock at the later view) is an expiry, gone before it a removal; a new end stamp or
 * duration is a refresh, then stacks, then value.
 */
export const auraLifecycle = (
  before: AuraView | undefined,
  after: AuraView | undefined,
  clocks: ArrayLike<number>,
): AuraLifecycle | undefined => {
  if (before === undefined) {
    return after === undefined ? undefined : 'applied';
  }

  if (after === undefined) {
    return Number.isFinite(before.end) && (clocks[before.clock] ?? 0) >= before.end ? 'expired' : 'removed';
  }

  if (after.end !== before.end || after.duration !== before.duration) {
    return 'refreshed';
  }

  if (after.stacks !== before.stacks) {
    return 'stacked';
  }

  return after.value === before.value ? undefined : 'changed';
};

/** The key of an aura instance in a view list. */
const keyOf = (view: AuraView): string => `${view.aura}:${view.serial}`;

/**
 * Every aura instance's change between two views of one bearer (§II.6 R4), matched by aura and serial: the later
 * view's instances in its order, then the ones that left, in the earlier view's order. For a client: it allocates.
 */
export const auraChanges = (
  before: readonly AuraView[],
  after: readonly AuraView[],
  clocks: ArrayLike<number>,
): AuraViewChange[] => {
  const earlier = new Map(before.map((view) => [keyOf(view), view]));
  const later = new Set(after.map(keyOf));
  const changes: AuraViewChange[] = [];

  const push = (view: AuraView, change: AuraLifecycle | undefined): void => {
    if (change !== undefined) {
      changes.push({ aura: view.aura, serial: view.serial, change });
    }
  };

  for (const view of after) {
    push(view, auraLifecycle(earlier.get(keyOf(view)), view, clocks));
  }

  for (const view of before) {
    if (!later.has(keyOf(view))) {
      push(view, auraLifecycle(view, undefined, clocks));
    }
  }

  return changes;
};
