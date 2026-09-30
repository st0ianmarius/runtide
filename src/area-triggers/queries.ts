import { covers, pathIntervals, type Vec2 } from '../math/index.ts';
import type { AreaTriggerContext, EndReason } from './area-def.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';

/** Which live area triggers a query keeps; every part is optional. */
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

/** A query for what covers a point or a path: a query, and the radius of the body tested. */
export interface CoverQuery<G extends AreaTriggerTypes> extends AreaQuery<G> {
  /** The body's radius; 0 (a bare point) by default. */
  readonly radius?: number;
}

/** Where a path first meets an area trigger (a projectile tested against domes before walls). Reused. */
export interface AreaInterception {
  /** The area trigger it meets first; `NO_AREA_TRIGGER` when it meets none. */
  handle: AreaTriggerHandle;

  /** The share along the path where it meets it (0 when it starts inside); 1 when it meets none. */
  share: number;
}

/**
 * What any code may ask of the area triggers, hooks included (`c.areas`): pure reads over the live ones, in
 * kind order and creation order.
 */
export interface AreaQueries<G extends AreaTriggerTypes> {
  /** Writes the handles a query keeps into `out` from index 0; returns how many. */
  readonly query: (query: AreaQuery<G>, out: (AreaTriggerHandle | undefined)[]) => number;

  /** A live area trigger's context; `undefined` once it ended. */
  readonly get: (handle: AreaTriggerHandle) => AreaTriggerContext<G> | undefined;

  /** A live area trigger's declared view (`AreaTriggerDef.view`); `undefined` for none, or once it ended. */
  readonly viewOf: (handle: AreaTriggerHandle) => Readonly<Record<string, number>> | undefined;

  /**
   * The first area trigger a query keeps whose shape covers a point (for a body of `radius`): the Sanctuary's shelter
   * tested at a blow's ignore stage. `NO_AREA_TRIGGER` when none does.
   */
  readonly coveredBy: (point: Vec2, query: CoverQuery<G>) => AreaTriggerHandle;

  /** Where a path from `from` to `to` first meets an area trigger a query keeps, written into `out`. */
  readonly intercept: (segment: readonly [Vec2, Vec2], query: CoverQuery<G>, out: AreaInterception) => AreaInterception;
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
  [query, kind, tag]: readonly [AreaQuery<G>, number, number]
): boolean =>
  (query.kind === undefined || query.kind === kind) && (tag < 0 || engine.registry.tagSets[kind]?.has(tag) === true);

/** Whether one live area trigger passes a query's owner and condition. */
const isKept = <G extends AreaTriggerTypes>(area: AreaTrigger<G>, query: AreaQuery<G>): boolean =>
  !area.isEnding && (query.owner === undefined || area.owner === query.owner) && (query.filter?.(area) ?? true);

/**
 * Writes the live area triggers a query keeps into `out` from index 0, kind by kind in registry order and each kind in
 * creation order, and returns how many.
 */
const collect = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  query: AreaQuery<G>,
  out: (AreaTrigger<G> | undefined)[]
): number => {
  const tag = query.tag === undefined ? -1 : tagIdOf(engine, query.tag);
  // An owner's own lists keep the kinds' tick order, so a query for one owner walks only its triggers.
  const owned = query.owner === undefined ? undefined : engine.ownerOf(query.owner);
  let count = 0;

  if (query.owner !== undefined && owned === undefined) {
    return 0;
  }

  for (const kind of engine.registry.ids) {
    if (!isKindKept(engine, [query, kind, tag])) {
      continue;
    }

    const head = owned === undefined ? engine.kindHeads[kind] : owned.heads[kind];

    for (let walk = head; walk !== undefined; walk = owned === undefined ? walk.kindNext : walk.ownerNext) {
      if (isKept(walk, query)) {
        out[count] = walk;
        count += 1;
      }
    }
  }

  return count;
};

/** Throws unless a reason is one the registry knows: the framework's, or one of the game's `endReasons`. */
export const checkReason = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, reason: string): void => {
  if (engine.registry.reasonCodes[reason] === undefined) {
    throw new RangeError(
      `Area triggers: unknown end reason ${reason}; name the game's reasons in the registry's endReasons.`
    );
  }
};

/** Ends every area trigger a query keeps, with a reason (`self` by default); returns how many ended. */
export const despawnWhere = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  query: AreaQuery<G>,
  reason: EndReason<G>
): number => {
  const handles = engine.handles.take();
  let count = 0;
  let ended = 0;

  engine.hold();

  try {
    count = engine.queries.query(query, handles);

    for (let i = 0; i < count; i++) {
      const area = engine.areaOf(handles[i] ?? NO_AREA_TRIGGER);

      if (area !== undefined) {
        endArea(engine, area, { reason });
        ended += 1;
      }
    }
  } finally {
    engine.handles.give(count);
    engine.unhold();
  }

  return ended;
};

/** The queries over one engine's area triggers, reusing their scratch. */
export class AreaQueryApi<G extends AreaTriggerTypes> implements AreaQueries<G> {
  readonly #engine: AreaEngine<G>;
  readonly #times: number[] = [];

  constructor(engine: AreaEngine<G>) {
    this.#engine = engine;
  }

  readonly query = (query: AreaQuery<G>, out: (AreaTriggerHandle | undefined)[]): number => {
    const found = this.#engine.records.take();
    const count = collect(this.#engine, query, found);

    for (let i = 0; i < count; i++) {
      out[i] = found[i]?.handle ?? NO_AREA_TRIGGER;
    }

    this.#engine.records.give(count);

    return count;
  };

  readonly get = (handle: AreaTriggerHandle): AreaTriggerContext<G> | undefined => this.#engine.areaOf(handle);

  readonly viewOf = (handle: AreaTriggerHandle): Readonly<Record<string, number>> | undefined => {
    const area = this.#engine.areaOf(handle);

    return area === undefined ? undefined : this.#engine.registry.get(area.kind).view?.(area);
  };

  readonly coveredBy = (point: Vec2, query: CoverQuery<G>): AreaTriggerHandle => {
    const found = this.#engine.records.take();
    const count = collect(this.#engine, query, found);
    let handle = NO_AREA_TRIGGER;

    for (let i = 0; i < count && handle === NO_AREA_TRIGGER; i++) {
      const area = found[i];

      if (area !== undefined && covers(area.shape, point, query.radius ?? 0)) {
        handle = area.handle;
      }
    }

    this.#engine.records.give(count);

    return handle;
  };

  readonly intercept = (
    [from, to]: readonly [Vec2, Vec2],
    query: CoverQuery<G>,
    out: AreaInterception
  ): AreaInterception => {
    const found = this.#engine.records.take();
    const count = collect(this.#engine, query, found);
    const path = { from, to, t0: 0, t1: 1, radius: query.radius ?? 0 };

    out.handle = NO_AREA_TRIGGER;
    out.share = 1;

    for (let i = 0; i < count; i++) {
      const area = found[i];
      const meets = area === undefined ? 0 : pathIntervals(area.shape, path, this.#times);
      const share = this.#times[0] ?? 1;

      if (area !== undefined && meets > 0 && (out.handle === NO_AREA_TRIGGER || share < out.share)) {
        out.handle = area.handle;
        out.share = share;
      }
    }

    this.#engine.records.give(count);

    return out;
  };
}
