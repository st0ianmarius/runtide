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
    endArea(engine, area, 'bound');

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

  area.isLifeSet = false;
  frame(engine, area, dt);

  if (area.isEnding) {
    return;
  }

  // A frame that set its time left (`setRemaining`) counts from there; else this frame's step counts down.
  area.remaining = area.isLifeSet ? area.remaining : countDown(area.remaining, dt);
  area.isLifeSet = false;

  if (isRunOut(area.remaining)) {
    endArea(engine, area, 'expired');
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
  engine.ledgers.sweep();

  const kinds = engine.slotKinds[slot] ?? [];
  const owned = owner === undefined ? undefined : engine.ownerOf(owner);

  if (owner !== undefined && owned === undefined) {
    return 0;
  }

  const handles = engine.handles.take();

  const count = owned === undefined ? snapshotAll(engine, kinds, handles) : snapshotOwned(owned, kinds, handles);

  engine.hold();

  try {
    return stepFrom(engine, handles, 0, count);
  } finally {
    engine.handles.give(count);
    engine.unhold();
  }
};

/**
 * Steps a snapshot's area triggers from `start`, skipping the ones gone or stepped this tick; how many stepped. One
 * whose step throws still has the rest stepped, so it never starves the others of its slot, then it throws.
 */
const stepFrom = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  handles: readonly (AreaTriggerHandle | undefined)[],
  start: number,
  count: number
): number => {
  let stepped = 0;

  for (let i = start; i < count; i++) {
    const area = engine.areaOf(handles[i] ?? NO_AREA_TRIGGER);

    if (area === undefined || area.steppedTick === engine.clock.tick) {
      continue;
    }

    try {
      stepArea(engine, area, engine.clock.dt);
    } catch (error) {
      stepFrom(engine, handles, i + 1, count);

      throw error;
    }

    stepped += 1;
  }

  return stepped;
};

/**
 * Ends, as `source-gone`, every area trigger of an owner that needs its owner: one that lives while its owner does,
 * one bound to its owner's presence, and one anchored on its owner. The unit system calls it as the owner dies or
 * despawns when wired through `units.areaTriggers`; an owner's others (a pool, a missile) live on. Returns how many ended.
 */
export const endOwned = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, owner: G['bearer']): number => {
  const owned = engine.ownerOf(owner);

  if (owned === undefined) {
    return 0;
  }

  const handles = engine.handles.take();
  const count = snapshotOwned(owned, engine.registry.ids, handles);
  let ended = 0;

  engine.hold();

  try {
    for (let i = 0; i < count; i++) {
      const area = engine.areaOf(handles[i] ?? NO_AREA_TRIGGER);

      if (area !== undefined && needsOwner(engine, area)) {
        endArea(engine, area, 'source-gone');
        ended += 1;
      }
    }
  } finally {
    engine.handles.give(count);
    engine.unhold();
  }

  return ended;
};

/** Whether an area trigger needs its owner in the world: its lifetime, its bound or its anchor is its owner. */
const needsOwner = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): boolean =>
  area.isOwnerLifetime ||
  engine.registry.get(area.kind).bound?.owner === 'present' ||
  ((engine.registry.columns.flags[area.kind] ?? 0) & ANCHOR_OWNER) !== 0;
