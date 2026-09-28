import type { AreaTriggerContext } from './area-def.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';
import type { AreaTriggerHandle } from './ids.ts';

/** Which live area triggers a query keeps (§II.6 W5); every part is optional. */
export interface AreaQuery<G extends AreaTriggerTypes> {
  /** Only this kind. */
  readonly kind?: AreaTriggerId;

  /** Only this owner's. */
  readonly owner?: G['bearer'];

  /** Only kinds with this tag. */
  readonly tag?: G['areaTag'];

  /** A condition on the area trigger (its state, its position). */
  readonly filter?: (c: AreaTriggerContext<G>) => boolean;
}

/** A tag's id from its name, throwing for an unknown one. */
const tagIdOf = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, tag: G['areaTag']): number => {
  const ids: Readonly<Record<string, number | undefined>> = engine.registry.tags.id;
  const id = ids[tag];

  if (id === undefined) {
    throw new RangeError(`unknown area trigger tag ${tag}.`);
  }

  return id;
};

/** Whether one kind passes a query's kind and tag. */
const isKindKept = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [query, kind, tag]: readonly [AreaQuery<G>, number, number],
) => (query.kind === undefined || query.kind === kind) && (tag < 0 || engine.registry.tagSets[kind]?.has(tag) === true);

/**
 * Writes the handles of the live area triggers a query keeps into `out` from index 0 (§II.6 W5), kind by kind in
 * registry order and each kind in creation order, and returns how many.
 */
export const queryAreas = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  query: AreaQuery<G>,
  out: AreaTriggerHandle[],
): number => {
  const tag = query.tag === undefined ? -1 : tagIdOf(engine, query.tag);
  let count = 0;

  for (const kind of engine.registry.ids) {
    if (!isKindKept(engine, [query, kind, tag])) {
      continue;
    }

    for (let walk = engine.kindHeads[kind]; walk !== undefined; walk = walk.kindNext) {
      const isKept =
        !walk.isEnding && (query.owner === undefined || walk.owner === query.owner) && (query.filter?.(walk) ?? true);

      if (isKept) {
        out[count] = walk.handle;
        count += 1;
      }
    }
  }

  return count;
};
