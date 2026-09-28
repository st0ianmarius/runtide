import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';

/**
 * Links an area trigger into the tick order (§II.6.1 rule 1, §II.6 K2): last in its own kind's list, or, for a child
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
