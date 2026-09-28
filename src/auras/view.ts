import type { AuraId, AuraTypes } from './aura-types.ts';
import { OWNER_ONLY } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { setOf } from './state.ts';

/**
 * One aura as the wire carries it (§I.5.3, §II.6 A7): ids and numbers only. The client draws the tile from its own
 * table keyed by `aura`, and tells an expiry from a removal by whether `remaining` had run out.
 */
export interface AuraView {
  /** The aura's registry id (its wire id). */
  readonly aura: AuraId;

  /** Tells instances of one aura apart; 0 for the one shared instance. */
  readonly serial: number;

  /** Its stacks. */
  readonly stacks: number;

  /** Its value. */
  readonly value: number;

  /** The length of the application that last set its clock, in seconds. */
  readonly duration: number;

  /** The seconds left; `Infinity` for an infinite aura. */
  readonly remaining: number;

  /** The tick of its bearer's clock on which it runs out; `Infinity` for an infinite aura. */
  readonly end: number;

  /** The id of the clock it counts on. */
  readonly clock: number;

  /** Who applied it, or `NO_SOURCE`. */
  readonly source: number;
}

/** Who a view is for. */
export interface ViewOptions {
  /** Whether it is for the bearer's own client, which also sees `ownerOnly` auras; false when absent. */
  readonly forOwner?: boolean;
}

/** A bearer's auras as views, in list order (registry order), leaving out `ownerOnly` ones unless it is for the owner. */
export const viewAuras = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  options: ViewOptions = {},
): AuraView[] => {
  const set = setOf<G>(bearer);
  const views: AuraView[] = [];

  for (const item of set.items) {
    if (options.forOwner !== true && ((engine.flags[item.id] ?? 0) & OWNER_ONLY) !== 0) {
      continue;
    }

    views.push({
      aura: item.id,
      serial: item.serial,
      stacks: item.stacks,
      value: item.value,
      duration: item.duration,
      remaining: engine.remainingOf(set, item),
      end: item.end,
      clock: item.clock,
      source: item.source,
    });
  }

  return views;
};
