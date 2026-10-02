import { DEAD_HOLD } from '../ai/index.ts';
import type { EventKind } from '../core/index.ts';
import type { Vec2 } from '../math/index.ts';
import { lateOf, type UnitEngine, unitOf } from './engine.ts';
import type { UnitEvent } from './events.ts';
import { despawnBound, leaveOwner, orphanSummons, rejoinOwner } from './summons.ts';
import type { Lifecycle, UnitTypes } from './unit-types.ts';

/**
 * The moves each lifecycle state allows: a living unit dies or despawns; a dead one is revived or
 * despawns; a despawned one is gone for good.
 */
const MOVES: Readonly<Record<Lifecycle, readonly Lifecycle[]>> = Object.freeze({
  alive: ['dead', 'despawned'],
  dead: ['alive', 'despawned'],
  despawned: []
});

/** Raises a unit event, when something hears it. */
const raise = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  kind: EventKind<UnitEvent<G>> | undefined,
  [unit, from, to, at, reason]: readonly [G['bearer'], Lifecycle, Lifecycle, Vec2 | undefined, string]
): void => {
  const bus = engine.options.events?.bus;

  if (bus === undefined || kind === undefined || !bus.hears(kind)) {
    return;
  }

  const payload = bus.payload(kind);

  payload.unit = unit;
  payload.from = from;
  payload.to = to;
  payload.at = at;
  payload.reason = reason;
  bus.raise(kind, payload);
  payload.unit = undefined;
  payload.at = undefined;
};

/** Raises a unit's spawn event, with the point its spawn asked for. */
export const raiseSpawned = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  unit: G['bearer'],
  at: Vec2 | undefined
): void => {
  raise(engine, engine.options.events?.spawned, [unit, 'alive', 'alive', at, '']);
};

/** Puts a unit on another side and raises `sideChanged`; false when it was on that side already. */
export const changeSide = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer'], side: number): boolean => {
  const unit = unitOf<G>(bearer);

  if (!Number.isInteger(side)) {
    throw new RangeError(`A side is a whole number; got ${side}.`);
  }

  if (unit.side === side) {
    return false;
  }

  unit.side = side;
  raise(engine, engine.options.events?.sideChanged, [bearer, unit.lifecycle, unit.lifecycle, undefined, '']);

  return true;
};

/**
 * A unit leaves life (dies or despawns): its casts end if it lived, it enters the matching bearer state (its auras
 * hear it, then those `removedOn` it go), it leaves its owner's summons, taking its bound ones along, and the auras it
 * put on others bound to it (`boundToSource`) come off them (`auras.sourceLeft`). Its dependent areas end and
 * its pending delayed lists are withdrawn, including those scheduled by the leaving hooks.
 */
const leaveFor = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  from: Lifecycle,
  to: Exclude<Lifecycle, 'alive'>
): void => {
  const { auras } = engine.options;

  // Its owner's summons are left, and its bound ones taken along, even when a cast's or an aura's hook throws.
  try {
    if (from === 'alive') {
      engine.options.spells.cancelAll(bearer);
    }

    if (auras.hasState(to)) {
      auras.enterState(bearer, to);
    }
  } finally {
    try {
      leaveOwner(engine, bearer, to === 'despawned');
      despawnBound(engine, bearer);
    } finally {
      releaseOwned(engine, bearer);
    }
  }
};

/** Removes source-bound auras, dependent areas and delayed lists, even when an earlier cleanup hook throws. */
const releaseOwned = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): void => {
  try {
    engine.options.auras.sourceLeft(unitOf<G>(bearer).id);
  } finally {
    try {
      engine.options.areaTriggers?.ownerGone(bearer);
    } finally {
      engine.options.spells.withdrawDelayed(bearer);
    }
  }
};

/**
 * A unit despawned: its id forgotten, its brain freed, the `despawned` event raised, then its script detached and its
 * auras released to their pool.
 */
const despawned = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  from: Lifecycle,
  reason: string
): void => {
  const unit = unitOf<G>(bearer);

  engine.byId.delete(unit.id);
  orphanSummons(bearer);
  engine.options.ai?.release(bearer);

  // A listener or script hook that throws still leaves the unit's script detached and its auras released.
  try {
    raise(engine, engine.options.events?.despawned, [bearer, from, 'despawned', undefined, reason]);
  } finally {
    try {
      if (unit.scriptSlot >= 0 && engine.options.scripts !== undefined) {
        lateOf(engine.options.scripts).detach(bearer);
      }
    } finally {
      unit.scriptSlot = -1;
      engine.options.auras.release(bearer);
    }
  }
};

/**
 * Moves a unit to a lifecycle state, when its state allows the move: a unit leaving life has every cast it
 * runs cancelled, enters the aura system's matching bearer state (its auras' `onState`, then those
 * `removedOn` it go: a death burst is an aura's `onState` of `dead`), leaves its owner's summons and takes its bound
 * summons along; a revive sets health (the maximum by default) and rejoins its owner's summons, if it still has one. Raises `changed`, or `despawned` with its
 * reason for a despawn, which also forgets the unit's entity id and frees its brain. A move asked for from its hooks or
 * events (a revive from a death's `onState`) waits until this one is done, so its events follow this one's; such
 * moves run in the order asked, each checked when its turn comes. False when the move is not allowed.
 */
export const moveTo = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  to: Lifecycle,
  health?: number,
  reason?: string
): boolean => {
  const unit = unitOf<G>(bearer);
  const from = unit.lifecycle;

  if (to === 'alive') {
    checkHealth(health);
  }

  if (unit.isMoving) {
    unit.nextMoves.push([to, health, reason]);

    return true;
  }

  if (!MOVES[from].includes(to)) {
    return false;
  }

  unit.isMoving = true;
  unit.lifecycle = to;

  try {
    enter(engine, bearer, from, health, reason);
  } catch (error) {
    // A hook threw: the move stops where it is, and the moves it asked for are dropped, not left for the next one.
    unit.nextMoves.length = 0;

    throw error;
  } finally {
    unit.isMoving = false;
  }

  // Each asked-for move is checked when its turn comes: a despawn queued after a revive still despawns.
  while (unit.nextMoves.length > 0 && !unit.isMoving) {
    const next = unit.nextMoves.shift();

    if (next !== undefined) {
      moveTo(engine, bearer, next[0], next[1], next[2]);
    }
  }

  return true;
};

/** Throws unless a revive's health is absent or a finite number above 0. */
const checkHealth = (health: number | undefined): void => {
  if (health !== undefined && !(Number.isFinite(health) && health > 0)) {
    throw new RangeError(`A unit revives with a finite health above 0; got ${health}.`);
  }
};

/** Runs a move's work and events, the unit in its new state already: what joining life, or leaving it, does. */
const enter = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  from: Lifecycle,
  health: number | undefined,
  reason: string | undefined
): void => {
  const unit = unitOf<G>(bearer);
  const to = unit.lifecycle;

  if (to === 'alive') {
    unit.health = Math.min(health ?? unit.maxHealth, unit.maxHealth);
    rejoinOwner(bearer);
    lifeChanged(engine, bearer, true);
  } else if (to === 'despawned') {
    // A despawn cannot be asked again: a hook that throws while it leaves still has it forgotten and released.
    try {
      leaveFor(engine, bearer, from, to);
    } finally {
      despawned(engine, bearer, from, reason ?? 'despawn');
    }

    return;
  } else {
    // Its brain and script stop even when a cast's or an aura's hook throws as it leaves life.
    try {
      leaveFor(engine, bearer, from, to);
    } finally {
      lifeChanged(engine, bearer, false);
    }
  }

  raise(engine, engine.options.events?.changed, [bearer, from, to, undefined, '']);
};

/**
 * A unit died or was revived: its brain is held by `DEAD_HOLD` while it is dead, its timers keeping what they had
 * left, and its script stops and goes on with them (`died` and `revived` handlers).
 */
const lifeChanged = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer'], isAlive: boolean): void => {
  const { ai, scripts } = engine.options;

  ai?.hold(bearer, DEAD_HOLD, !isAlive);

  if (unitOf<G>(bearer).scriptSlot >= 0 && scripts !== undefined) {
    const side = lateOf(scripts);

    if (isAlive) {
      side.revived(bearer);
    } else {
      side.died(bearer);
    }
  }
};
