/**
 * An aura's lifecycle as a client derives it from two views of its bearer, at zero bytes. An instance that stays is
 * read in this order: its stacks differ, `stacked`; else its value differs, `changed`; else its end moved earlier with
 * its duration the same, nothing (a time-left change, `scaleTimeLeft` or `clampTimeLeft`, which the server raises
 * nothing for: a refresh of the same length only ever moves the end later or leaves it); else its end or its duration
 * differ, `refreshed`. The server raises one `refreshed` for all three (`onRefreshed`: its clock set again, its stacks
 * or its value changed), so a client with one refresh cue plays it for `stacked`, `changed` and `refreshed` alike, and
 * a client that wants finer cues keys on them. A time left lengthened (a factor above 1) reads as `refreshed`: two
 * views cannot tell it from a refresh of the same length.
 */
import type { AuraView } from '../auras/index.ts';

/**
 * What happened to one aura between two views of its bearer, as a client derives it at zero bytes:
 * `applied`, `stacked` (its stacks changed), `changed` (its value changed, its stacks the same), `refreshed` (its clock
 * was set again, its stacks and value the same), `expired` (it left when its end stamp had come) or `removed` (it left
 * before). The server's one `refreshed` event covers `stacked`, `changed` and `refreshed` here: play one refresh cue for
 * all three, or key finer cues on them. An end moved earlier with the same duration is a time-left change, which the
 * server raises nothing for, and derives nothing.
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
 * `clocks` (the bearer's steps per clock at the later view) is an expiry, gone before it a removal; then new stacks,
 * then a new value, then an end moved earlier with the same duration is nothing (a time-left change), then a new end
 * stamp or duration is a refresh.
 *
 * Two of these are exact only at one view per tick of the aura's clock. Expired against removed: a client reading
 * views less often sees an aura dispelled within one view interval of its end, its end stamp reached by the later
 * view, as `expired`. A shared instance (serial 0, the one of a non-`independent`, non-`perSource` aura) cleansed and
 * applied again between two views keeps its key, so it reads as `refreshed` (or `stacked`, `changed`, or nothing, by
 * what differs), not as `removed` then `applied`. A game that cues on these exactly reads a view every tick, or takes
 * them from the server's events.
 */
export const auraLifecycle = (
  before: AuraView | undefined,
  after: AuraView | undefined,
  clocks: ArrayLike<number>
): AuraLifecycle | undefined => {
  if (before === undefined) {
    return after === undefined ? undefined : 'applied';
  }

  if (after === undefined) {
    return Number.isFinite(before.end) && (clocks[before.clock] ?? 0) >= before.end ? 'expired' : 'removed';
  }

  if (after.stacks !== before.stacks) {
    return 'stacked';
  }

  if (after.value !== before.value) {
    return 'changed';
  }

  if (after.duration === before.duration) {
    return after.end > before.end ? 'refreshed' : undefined;
  }

  return 'refreshed';
};

/** The key of an aura instance in a view list. */
const keyOf = (view: AuraView): string => `${view.aura}:${view.serial}`;

/**
 * Every aura instance's change between two views of one bearer, matched by aura and serial: the later
 * view's instances in its order, then the ones that left, in the earlier view's order. For a client: it allocates.
 * Exact only at one view per tick of each aura's clock (`auraLifecycle`): read less often, a dispel near an aura's end
 * reads `expired`, and a shared instance cleansed and applied again between the views reads as one that stayed.
 */
export const auraChanges = (
  before: readonly AuraView[],
  after: readonly AuraView[],
  clocks: ArrayLike<number>
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
