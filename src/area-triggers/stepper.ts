import { countDown, isRunOut } from '../core/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import { ANCHOR_OWNER } from './define-area-triggers.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { frame } from './frame.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
import type { OwnerAreas } from './order.ts';

/**
 * Checks what binds it before its frame: its `suspendWhile` suspends it (its clock and hooks too); a failed `when`
 * ends it as `bound`. Returns whether it runs this frame. (Its owner leaving is told, not asked: `ownerGone`.)
 */
const checkBound = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): boolean => {
  const { bound } = engine.registry.get(area.kind);

  if (bound === undefined) {
    return true;
  }

  area.isSuspended = bound.suspendWhile?.(area) === true;

  if (area.isSuspended) {
    return false;
  }

  if (bound.when !== undefined && !bound.when(area)) {
    endArea(engine, area, { reason: 'bound' });

    return false;
  }

  return true;
};

/**
 * Steps one area trigger by `dt`: its bound is checked (a suspended one waits, its clock too), then its frame runs
 * and its lifetime counts down, the last frame running whole: it expires once it ran out. A hook that wants the last
 * frame cut short reads `c.remaining`.
 */
export const stepArea = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, dt: number): void => {
  area.steppedTick = engine.clock.tick;

  if (!checkBound(engine, area)) {
    return;
  }

  const next = countDown(area.remaining, dt);
  const isOut = isRunOut(next);

  frame(engine, area, dt);

  if (area.isEnding) {
    return;
  }

  area.remaining = next;

  if (isOut) {
    endArea(engine, area, { reason: 'expired' });
  }
};

/** Writes the handles of every area trigger of some kinds' lists into `out`; returns how many. */
const snapshotAll = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  kinds: readonly number[],
  out: (AreaTriggerHandle | undefined)[]
): number => {
  let count = 0;

  for (const kind of kinds) {
    for (let walk = engine.kindHeads[kind]; walk !== undefined; walk = walk.kindNext) {
      out[count] = walk.handle;
      count += 1;
    }
  }

  return count;
};

/** Writes the handles of one owner's area triggers of some kinds into `out`; returns how many. */
const snapshotOwned = <G extends AreaTriggerTypes>(
  owned: OwnerAreas<G>,
  kinds: readonly number[],
  out: (AreaTriggerHandle | undefined)[]
): number => {
  let count = 0;

  for (const kind of kinds) {
    for (let walk = owned.heads[kind]; walk !== undefined; walk = walk.ownerNext) {
      out[count] = walk.handle;
      count += 1;
    }
  }

  return count;
};

/**
 * Steps every area trigger of a tick slot once, or only one owner's: kind by kind in
 * registry order, each kind's list in creation order. The walk
 * reads a snapshot of handles, so what ends during it is skipped and what spawns during it waits for the next tick.
 * An owner's walk reads the owner's own lists, in the same order: one with none costs a lookup. Returns how many
 * stepped.
 */
export const stepSlot = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  slot: number,
  owner: G['bearer'] | undefined
): number => {
  const kinds = engine.slotKinds[slot] ?? [];
  const owned = owner === undefined ? undefined : engine.ownerOf(owner);

  if (owner !== undefined && owned === undefined) {
    return 0;
  }

  const handles = engine.handles.take();

  const count = owned === undefined ? snapshotAll(engine, kinds, handles) : snapshotOwned(owned, kinds, handles);

  let stepped = 0;

  try {
    for (let i = 0; i < count; i++) {
      const area = engine.areaOf(handles[i] ?? NO_AREA_TRIGGER);

      if (area !== undefined && area.steppedTick !== engine.clock.tick) {
        stepArea(engine, area, engine.clock.dt);
        stepped += 1;
      }
    }
  } finally {
    engine.handles.give(count);
  }

  return stepped;
};

/**
 * Ends, as `source-gone`, every area trigger of an owner that needs its owner: one that lives while its owner does,
 * one bound to its owner's presence, and one anchored on its owner. The game calls it as the owner leaves the world
 * (its despawn); an owner's others (a pool, a missile) live on. Returns how many ended.
 */
export const endOwned = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, owner: G['bearer']): number => {
  const owned = engine.ownerOf(owner);

  if (owned === undefined) {
    return 0;
  }

  const handles = engine.handles.take();
  const count = snapshotOwned(owned, engine.registry.ids, handles);
  let ended = 0;

  try {
    for (let i = 0; i < count; i++) {
      const area = engine.areaOf(handles[i] ?? NO_AREA_TRIGGER);

      if (area !== undefined && needsOwner(engine, area)) {
        endArea(engine, area, { reason: 'source-gone' });
        ended += 1;
      }
    }
  } finally {
    engine.handles.give(count);
  }

  return ended;
};

/** Whether an area trigger needs its owner in the world: its lifetime, its bound or its anchor is its owner. */
const needsOwner = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): boolean =>
  area.isOwnerLifetime ||
  engine.registry.get(area.kind).bound?.owner === 'present' ||
  ((engine.registry.columns.flags[area.kind] ?? 0) & ANCHOR_OWNER) !== 0;
