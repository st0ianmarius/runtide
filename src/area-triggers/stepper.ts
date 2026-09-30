import { countDown, isRunOut } from '../core/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { frame } from './frame.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
import type { OwnerAreas } from './order.ts';

/** The expiry modes' codes, as the `expiry` column holds them. */
const EXPIRY_BEFORE = 1;
const EXPIRY_CLIP = 2;

/** Binding bit: it ends as `source-gone` when its owner leaves the world. */
export const BIND_PRESENT = 1;

/** Binding bit: it needs its owner standing as well. */
export const BIND_STANDING = 2;

/** Binding bit: it waits while its owner is down, rather than ending. */
export const BIND_SUSPEND = 4;

/** Whether a unit is in the world, as the host says (true when it cannot tell). */
const isPresent = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, unit: G['bearer']): boolean =>
  engine.host.isPresent?.(unit) ?? true;

/** Whether a unit is standing, as the host says (true when it cannot tell). */
const isStanding = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, unit: G['bearer']): boolean =>
  engine.host.isStanding?.(unit) ?? true;

/**
 * Checks its owner: an owner that left ends it as `source-gone`; a standing-bound owner that is down ends
 * it as `bound` or suspends it. A lifetime of `owner` binds it to its owner standing. Returns whether it runs on.
 */
const checkOwner = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): boolean => {
  const bits = (engine.bindings[area.kind] ?? 0) | (area.isOwnerLifetime ? BIND_PRESENT | BIND_STANDING : 0);

  if (bits === 0) {
    return true;
  }

  if (!isPresent(engine, area.owner)) {
    endArea(engine, area, { reason: 'source-gone' });

    return false;
  }

  if ((bits & BIND_STANDING) === 0 || isStanding(engine, area.owner)) {
    area.isSuspended = false;

    return true;
  }

  if ((bits & BIND_SUSPEND) !== 0) {
    area.isSuspended = true;

    return false;
  }

  endArea(engine, area, { reason: area.isOwnerLifetime ? 'source-gone' : 'bound' });

  return false;
};

/**
 * Checks what binds it before its frame: its owner, the owner's interrupts it waits out (suspended while held), then
 * its condition. Returns whether it runs this frame.
 */
const checkBound = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): boolean => {
  if (!checkOwner(engine, area)) {
    return false;
  }

  const pausedBy = engine.pauseMasks[area.kind] ?? 0;

  area.isSuspended = pausedBy !== 0 && (engine.spells.heldInterrupts(area.owner) & pausedBy) !== 0;

  if (area.isSuspended) {
    return false;
  }

  const { bound } = engine.registry.get(area.kind);

  if (bound?.when !== undefined && !bound.when(area)) {
    endArea(engine, area, { reason: 'bound' });

    return false;
  }

  return true;
};

/**
 * Steps one area trigger by `dt`: its bound is checked (a suspended one waits, its clock too), then its
 * lifetime counts down around its frame as its expiry mode says: `after` runs the last frame
 * whole, `before` expires without it, `clip` runs it with `dt` cut to the time left. It expires once it ran out.
 */
export const stepArea = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, dt: number): void => {
  area.steppedTick = engine.clock.tick;

  if (!checkBound(engine, area)) {
    return;
  }

  const next = countDown(area.remaining, dt);
  const isOut = isRunOut(next);
  const mode = engine.registry.columns.expiry[area.kind] ?? 0;

  if (isOut && mode === EXPIRY_BEFORE) {
    area.remaining = 0;
    endArea(engine, area, { reason: 'expired' });

    return;
  }

  frame(engine, area, isOut && mode === EXPIRY_CLIP ? area.remaining : dt);

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
  out: (AreaTriggerHandle | undefined)[],
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
  out: (AreaTriggerHandle | undefined)[],
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
  owner: G['bearer'] | undefined,
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
