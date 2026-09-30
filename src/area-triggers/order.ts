import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';

/**
 * What one owner has live: how many of each kind (for `perOwner` limits and owner auras), and its area
 * triggers in each tick-order list, in that list's order, so `stepOwner` walks the owner's own and nothing else.
 */
export class OwnerAreas<G extends AreaTriggerTypes> {
  /** How many of each kind, by kind id. */
  readonly counts: Uint16Array;

  /** How many in all. */
  total = 0;

  /** The first and last of the owner's in each tick-order list, by list kind. */
  readonly heads: (AreaTrigger<G> | undefined)[];
  readonly tails: (AreaTrigger<G> | undefined)[];

  constructor(kinds: number) {
    this.counts = new Uint16Array(kinds);
    this.heads = Array.from({ length: kinds }, () => undefined);
    this.tails = Array.from({ length: kinds }, () => undefined);
  }
}

/** The owner's area trigger just before `area` in its tick-order list, walking back past other owners'. */
const ownerBefore = <G extends AreaTriggerTypes>(area: AreaTrigger<G>): AreaTrigger<G> | undefined => {
  let walk = area.tickPrev;

  while (walk !== undefined && walk.owner !== area.owner) {
    walk = walk.tickPrev;
  }

  return walk;
};

/** Links a freshly placed area trigger into its owner's list, keeping the tick order (`before` is the owner's before it). */
const linkOwner = <G extends AreaTriggerTypes>(
  owned: OwnerAreas<G>,
  area: AreaTrigger<G>,
  before: AreaTrigger<G> | undefined,
): void => {
  const kind = area.listKind;
  const next = before === undefined ? owned.heads[kind] : before.ownerNext;

  area.ownerPrev = before;
  area.ownerNext = next;

  if (before === undefined) {
    owned.heads[kind] = area;
  } else {
    before.ownerNext = area;
  }

  if (next === undefined) {
    owned.tails[kind] = area;
  } else {
    next.ownerPrev = area;
  }
};

/** Takes an area trigger out of its owner's list. */
const unlinkOwner = <G extends AreaTriggerTypes>(owned: OwnerAreas<G> | undefined, area: AreaTrigger<G>): void => {
  const { ownerPrev: prev, ownerNext: next } = area;
  const kind = area.listKind;

  if (owned === undefined) {
    return;
  }

  if (prev === undefined) {
    owned.heads[kind] = next;
  } else {
    prev.ownerNext = next;
  }

  if (next === undefined) {
    owned.tails[kind] = prev;
  } else {
    next.ownerPrev = prev;
  }
};

/**
 * Links an area trigger into the tick order: last in its own kind's list, or, for a child
 * that ticks after its parent, right after the parent and the children (and their children) placed after it before,
 * in its parent's list and slot.
 */
export const linkTick = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  parent: AreaTrigger<G> | undefined,
): void => {
  if (parent === undefined) {
    const tail = engine.tickTails[area.listKind];

    area.tickPrev = tail;
    area.tickNext = undefined;

    if (tail === undefined) {
      engine.tickHeads[area.listKind] = area;
    } else {
      tail.tickNext = area;
    }

    engine.tickTails[area.listKind] = area;

    const owned = engine.ownerFor(area.owner);

    linkOwner(owned, area, owned.tails[area.listKind]);

    return;
  }

  let after = parent;

  while (after.lastChild !== undefined) {
    after = after.lastChild;
  }

  const next = after.tickNext;

  area.listKind = parent.listKind;
  area.slot = parent.slot;
  area.tickPrev = after;
  area.tickNext = next;
  after.tickNext = area;

  if (next === undefined) {
    engine.tickTails[area.listKind] = area;
  } else {
    next.tickPrev = area;
  }

  parent.lastChild = area;
  linkOwner(engine.ownerFor(area.owner), area, ownerBefore(area));
};

/** The child placed after `parent` just before `child`, or `undefined` when `child` was its first. */
const siblingBefore = <G extends AreaTriggerTypes>(
  parent: AreaTrigger<G>,
  child: AreaTrigger<G>,
): AreaTrigger<G> | undefined => {
  for (let walk = child.tickPrev; walk !== undefined && walk !== parent; walk = walk.tickPrev) {
    if (walk.parent === parent.handle) {
      return walk;
    }
  }

  return undefined;
};

/** Takes an area trigger out of the tick order; a parent whose last child it was falls back to the one before. */
export const unlinkTick = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const { tickPrev: prev, tickNext: next } = area;
  const parent = engine.recordOf(area.parent);

  if (parent?.lastChild === area) {
    parent.lastChild = siblingBefore(parent, area);
  }

  unlinkOwner(engine.ownerOf(area.owner), area);

  if (prev === undefined) {
    engine.tickHeads[area.listKind] = next;
  } else {
    prev.tickNext = next;
  }

  if (next === undefined) {
    engine.tickTails[area.listKind] = prev;
  } else {
    next.tickPrev = prev;
  }
};

/** Links an area trigger last in its kind's creation order. */
export const linkKind = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const tail = engine.kindTails[area.kind];

  area.kindPrev = tail;
  area.kindNext = undefined;

  if (tail === undefined) {
    engine.kindHeads[area.kind] = area;
  } else {
    tail.kindNext = area;
  }

  engine.kindTails[area.kind] = area;
};

/** Takes an area trigger out of its kind's creation order. */
export const unlinkKind = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const { kindPrev: prev, kindNext: next } = area;

  if (prev === undefined) {
    engine.kindHeads[area.kind] = next;
  } else {
    prev.kindNext = next;
  }

  if (next === undefined) {
    engine.kindTails[area.kind] = prev;
  } else {
    next.kindPrev = prev;
  }
};
