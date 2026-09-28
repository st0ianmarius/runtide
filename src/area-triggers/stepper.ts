import { countDown, isRunOut } from '../core/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import { ANCHOR_OWNER } from './define-area-triggers.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { NO_AREA_TRIGGER } from './ids.ts';

/** The expiry modes' codes, as the `expiry` column holds them. */
const EXPIRY_BEFORE = 1;
const EXPIRY_CLIP = 2;

/** Places an area trigger's shape at its position and heading: its kind's shape, or what its shape function says. */
export const placeShape = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const { shape } = engine.registry.get(area.kind);

  area.placer.place(typeof shape === 'function' ? shape(area) : shape, area.position, area.heading);
};

/** Binding bit: it ends as `source-gone` when its owner leaves the world. */
export const BIND_PRESENT = 1;

/** Binding bit: it needs its owner standing as well. */
export const BIND_STANDING = 2;

/** Binding bit: it waits while its owner is down, rather than ending. */
export const BIND_SUSPEND = 4;

/** Binding bit: its bound ends fire no end cue. */
export const BIND_SILENT = 8;

/** Whether a unit is in the world, as the host says (true when it cannot tell). */
const isPresent = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, unit: G['bearer']): boolean =>
  engine.host.isPresent?.(unit) ?? true;

/** Whether a unit is standing, as the host says (true when it cannot tell). */
const isStanding = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, unit: G['bearer']): boolean =>
  engine.host.isStanding?.(unit) ?? true;

/**
 * Checks its owner (§II.6 W1): an owner that left ends it as `source-gone`; a standing-bound owner that is down ends
 * it as `bound` or suspends it. A lifetime of `owner` binds it to its owner standing. Returns whether it runs on.
 */
const checkOwner = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): boolean => {
  const bits = (engine.bindings[area.kind] ?? 0) | (area.isOwnerLifetime ? BIND_PRESENT | BIND_STANDING : 0);

  if (bits === 0) {
    return true;
  }

  const isSilent = (bits & BIND_SILENT) !== 0;

  if (!isPresent(engine, area.owner)) {
    endArea(engine, area, { reason: 'source-gone', isSilent });

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

  endArea(engine, area, { reason: area.isOwnerLifetime ? 'source-gone' : 'bound', isSilent });

  return false;
};

/** Checks what binds it before its frame: its owner, then its condition. Returns whether it runs this frame. */
const checkBound = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): boolean => {
  if (!checkOwner(engine, area)) {
    return false;
  }

  const { bound } = engine.registry.get(area.kind);

  if (bound?.when !== undefined && !bound.when(area)) {
    endArea(engine, area, { reason: 'bound', isSilent: bound.cue === 'silent' });

    return false;
  }

  return true;
};

/** Runs its `frame` hook with the reusable proc list. */
const runFrame = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, dt: number): void => {
  const frame = engine.registry.hooks.frame[area.kind];

  if (frame === undefined) {
    return;
  }

  const list = engine.takeList();

  try {
    engine.run(area, frame(area, dt, list), list);
  } finally {
    engine.giveList(list);
  }
};

/**
 * One frame over `dt` (§II.3.4, §II.6 W2): it ages, an owner-anchored one moves onto its owner, it notes where it
 * was, runs `move`, places its shape, runs `frame`, and ends when a hook asked it to.
 */
const frame = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, dt: number): void => {
  const { registry } = engine;

  area.age += dt;

  if (((registry.columns.flags[area.kind] ?? 0) & ANCHOR_OWNER) !== 0) {
    area.moveTo((engine.host.positionOf ?? engine.world.positionOf)(area.owner));
  }

  area.previous.x = area.position.x;
  area.previous.z = area.position.z;
  registry.hooks.move[area.kind]?.(area, dt);
  placeShape(engine, area);
  runFrame(engine, area, dt);

  if (area.pending !== undefined && !area.isEnding) {
    endArea(engine, area, { reason: area.pending });
  }
};

/**
 * Steps one area trigger by `dt` (§II.6 W2): its bound is checked (a suspended one waits, its clock too), then its
 * lifetime counts down under the clock's rule around its frame as its expiry mode says: `after` runs the last frame
 * whole, `before` expires without it, `clip` runs it with `dt` cut to the time left. It expires once it ran out.
 */
export const stepArea = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, dt: number): void => {
  const { countdown } = engine.clock;

  area.steppedTick = engine.clock.tick;

  if (!checkBound(engine, area)) {
    return;
  }

  const next = countDown(area.remaining, dt, countdown);
  const isOut = isRunOut(next, countdown);
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

/**
 * Steps every area trigger of a tick slot once (§II.6.1 rule 1, §II.6 K2), or only one owner's: kind by kind in
 * registry order, each kind's list in creation order with after-parent children right after their parents. The walk
 * reads a snapshot of handles, so what ends during it is skipped and what spawns during it waits for the next tick.
 * Returns how many stepped.
 */
export const stepSlot = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  slot: number,
  owner: G['bearer'] | undefined,
): number => {
  const kinds = engine.slotKinds[slot] ?? [];
  const handles = engine.handles.take();
  let count = 0;
  let stepped = 0;

  for (const kind of kinds) {
    for (let walk = engine.tickHeads[kind]; walk !== undefined; walk = walk.tickNext) {
      if (owner === undefined || walk.owner === owner) {
        handles[count] = walk.handle;
        count += 1;
      }
    }
  }

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
