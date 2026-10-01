import type { ActiveAura } from './active-aura.ts';
import type { AuraTagId, AuraTypes } from './aura-types.ts';
import type { AuraEngine } from './engine.ts';
import { takeOff } from './remove.ts';
import { setOf } from './state.ts';

/** What a dispel takes: auras granting a tag, at most `limit` of them, those `filter` keeps, and who dispels. */
export interface Dispel<G extends AuraTypes> {
  /** The tag its auras grant (`magic`, `poison`, `curse`). */
  readonly tag: AuraTagId;

  /** The most it takes, in list order; all of them when absent. */
  readonly limit?: number;

  /** Which of them it may take (a purge taking only buffs, a dispel only another's debuffs); all when absent. */
  readonly filter?: (aura: ActiveAura<G>) => boolean;

  /** The entity id of who dispels: its events and the removed auras' `onRemoved` see it as `remover`. */
  readonly by?: number;
}

/**
 * Dispels: takes up to a limit of the auras granting a tag that its filter keeps, in list order, each raising
 * `removed` with the cause `dispel` and the dispeller as its remover (an aura that punishes its dispeller reads it in
 * `onRemoved`). Returns how many went.
 */
export const dispel = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], spec: Dispel<G>): number => {
  const set = setOf<G>(bearer);
  const limit = spec.limit ?? Number.POSITIVE_INFINITY;
  const from = engine.events.open('dispel', spec.by);
  let removed = 0;

  if (!(limit >= 0)) {
    throw new RangeError(`A dispel takes a limit from 0; got ${spec.limit}.`);
  }

  try {
    for (let i = 0; i < set.items.length && removed < limit; i++) {
      const item = set.items[i];

      if (
        item !== undefined &&
        engine.tables.tagBits[item.id]?.has(spec.tag) === true &&
        spec.filter?.(item) !== false
      ) {
        takeOff(engine, bearer, i);
        i -= 1;
        removed += 1;
      }
    }

    if (removed > 0) {
      engine.refreshTags(set);
    }
  } finally {
    engine.events.close(from);
  }

  return removed;
};
