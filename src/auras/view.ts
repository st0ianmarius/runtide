// Views are written per bearer per snapshot, so the loop is indexed.
/* oxlint-disable typescript/prefer-for-of */
import { toId } from '../core/ids.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';
import { OWNER_ONLY } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { setOf } from './state.ts';

/**
 * One aura as the wire carries it: ids and numbers only. The client draws the tile from its own
 * table keyed by `aura`, and tells an expiry from a removal by whether `remaining` had run out. `auras.view` fills the
 * caller's records, reused from one call to the next: read them at once, or copy what you keep.
 */
export interface AuraView {
  /** The aura's registry id (its wire id). */
  aura: AuraId;

  /** Tells instances of one aura apart; 0 for the one shared instance. */
  serial: number;

  /** Its stacks. */
  stacks: number;

  /** Its value. */
  value: number;

  /** The length of the application that last set its clock, in seconds. */
  duration: number;

  /** The seconds left; `Infinity` for an infinite aura. */
  remaining: number;

  /** The tick of its bearer's clock on which it runs out; `Infinity` for an infinite aura. */
  end: number;

  /** The id of the clock it counts on. */
  clock: number;

  /** Who applied it, or `NO_SOURCE`. */
  source: number;
}

/** Who a view is for. */
export interface ViewOptions {
  /** Whether it is for the bearer's own client, which also sees `ownerOnly` auras; false when absent. */
  readonly forOwner?: boolean;
}

/** A new view record, which `viewAuras` fills. */
const newView = (): AuraView => ({
  aura: toId<'auras'>(0),
  serial: 0,
  stacks: 0,
  value: 0,
  duration: 0,
  remaining: 0,
  end: 0,
  clock: 0,
  source: 0,
});

/**
 * Writes a bearer's auras as views into `out` from index 0, in list order (registry order), leaving out `ownerOnly`
 * ones unless it is for the owner; returns how many. `out` keeps its records between calls, so a steady bearer's
 * views allocate nothing.
 */
export const viewAuras = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  [bearer, out]: readonly [G['bearer'], AuraView[]],
  options: ViewOptions = {},
): number => {
  const set = setOf<G>(bearer);
  let count = 0;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item === undefined || (options.forOwner !== true && ((engine.flags[item.id] ?? 0) & OWNER_ONLY) !== 0)) {
      continue;
    }

    const view = (out[count] ??= newView());

    view.aura = item.id;
    view.serial = item.serial;
    view.stacks = item.stacks;
    view.value = item.value;
    view.duration = item.duration;
    view.remaining = engine.remainingOf(set, item);
    view.end = item.end;
    view.clock = item.clock;
    view.source = item.source;
    count += 1;
  }

  return count;
};
