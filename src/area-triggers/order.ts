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

  /** The first and last of the owner's in each tick-order list, by kind. */
  readonly heads: (AreaTrigger<G> | undefined)[];
  readonly tails: (AreaTrigger<G> | undefined)[];

  constructor(kinds: number) {
    this.counts = new Uint16Array(kinds);
    this.heads = Array.from({ length: kinds }, () => undefined);
    this.tails = Array.from({ length: kinds }, () => undefined);
  }

  /** Empties the record for its next owner. */
  clear(): void {
    this.counts.fill(0);
    this.total = 0;
    this.heads.fill(undefined);
    this.tails.fill(undefined);
  }
}

/** Links a freshly placed area trigger into its owner's list, keeping the tick order (`before` is the owner's before it). */
const linkOwner = <G extends AreaTriggerTypes>(
  owned: OwnerAreas<G>,
  area: AreaTrigger<G>,
  before: AreaTrigger<G> | undefined,
): void => {
  const { kind } = area;
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
  const { kind } = area;

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

/** Links an area trigger last in its kind's tick-order list, and in its owner's. */
export const linkTick = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const tail = engine.tickTails[area.kind];

  area.tickPrev = tail;
  area.tickNext = undefined;

  if (tail === undefined) {
    engine.tickHeads[area.kind] = area;
  } else {
    tail.tickNext = area;
  }

  engine.tickTails[area.kind] = area;

  const owned = engine.ownerFor(area.owner);

  linkOwner(owned, area, owned.tails[area.kind]);
};

/** Takes an area trigger out of the tick order. */
export const unlinkTick = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const { tickPrev: prev, tickNext: next } = area;

  unlinkOwner(engine.ownerOf(area.owner), area);

  if (prev === undefined) {
    engine.tickHeads[area.kind] = next;
  } else {
    prev.tickNext = next;
  }

  if (next === undefined) {
    engine.tickTails[area.kind] = prev;
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
