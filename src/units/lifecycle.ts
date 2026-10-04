import { DEAD_HOLD } from '../ai/index.ts';
import type { EventKind } from '../core/index.ts';
import type { Vec2 } from '../math/index.ts';
import { type Caught, caught, rethrow } from './cleanup.ts';
import { lateOf, type UnitEngine, unitOf } from './engine.ts';
import type { UnitEvent } from './events.ts';
import { clampHealth } from './health.ts';
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
 * hear it, then those `removedOn` it go), it leaves its owner's summons, taking its bound ones along, and what it owns
 * goes (`releaseOwned`). Every step runs even when one throws; the first error surfaces (`rethrow`).
 */
const leaveFor = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  from: Lifecycle,
  to: Exclude<Lifecycle, 'alive'>
): void => {
  const { auras } = engine.options;
  let errors: Caught | undefined;

  // A cast's `onEnd` that throws as it is cancelled still lets the unit enter its state (its death bursts, its
  // `removedOn` auras going).
  try {
    if (from === 'alive') {
      engine.options.spells.cancelAll(bearer);
    }
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    if (auras.hasState(to)) {
      auras.enterState(bearer, to);
    }
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    leaveOwner(engine, bearer, to === 'despawned');
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    despawnBound(engine, bearer);
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    releaseOwned(engine, bearer);
  } catch (error) {
    errors = caught(errors, error);
  }

  rethrow(errors);
};

/**
 * What a unit leaving life owns goes, each step even when one before it throws: its dependent areas end first (their
 * end hooks may still put its source-bound auras on others or schedule its delayed lists), then the auras it put on
 * others bound to it (`boundToSource`) come off them (`auras.sourceLeft`), then its pending delayed lists are
 * withdrawn. What runs after this (a `changed` or `despawned` listener, a script's `died` handler) is not tracked: an
 * aura it puts on another bound to the unit, or a list it owns, stays.
 */
const releaseOwned = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): void => {
  let errors: Caught | undefined;

  try {
    engine.options.areaTriggers?.ownerGone(bearer);
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    engine.options.auras.sourceLeft(unitOf<G>(bearer).id);
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    engine.options.spells.withdrawDelayed(bearer);
  } catch (error) {
    errors = caught(errors, error);
  }

  rethrow(errors);
};

/**
 * A unit despawned: its id forgotten, its brain freed, the `despawned` event raised, then its script detached and its
 * auras released to their pool, each even when one before it throws (the first error surfaces).
 */
const despawned = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  from: Lifecycle,
  reason: string
): void => {
  const unit = unitOf<G>(bearer);
  let errors: Caught | undefined;

  engine.byId.delete(unit.id);
  orphanSummons(bearer);
  engine.options.ai?.release(bearer);

  try {
    raise(engine, engine.options.events?.despawned, [bearer, from, 'despawned', undefined, reason]);
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    if (unit.scriptSlot >= 0 && engine.options.scripts !== undefined) {
      lateOf(engine.options.scripts).detach(bearer);
    }
  } catch (error) {
    errors = caught(errors, error);
  }

  unit.scriptSlot = -1;

  try {
    engine.options.auras.release(bearer);
  } catch (error) {
    errors = caught(errors, error);
  }

  rethrow(errors);
};

/**
 * Moves a unit to a lifecycle state, when its state allows the move: a unit leaving life has every cast it
 * runs cancelled, enters the aura system's matching bearer state (its auras' `onState`, then those
 * `removedOn` it go: a death burst is an aura's `onState` of `dead`), leaves its owner's summons and takes its bound
 * summons along; a move to `dead` with a health sets it first (a kill's 0); a revive sets health (the maximum by
 * default) and rejoins its owner's summons, if it still has one and its summon limit has room. Raises `changed`, or
 * `despawned` with its reason for a despawn, which also forgets the unit's entity id and frees its brain. A move asked
 * for from its hooks or events (a revive from a death's `onState`) waits until this one is done, so its events follow
 * this one's; such moves run in the order asked, each checked when its turn comes. A hook or listener that throws stops
 * nothing: the move's event is still raised and the queued moves still run, then the first error surfaces, the later
 * ones suppressed behind it (`SuppressedError`). False when the move is not allowed; true when it was made, or queued
 * behind the running move (it may still be refused when its turn comes: read the unit's `lifecycle` after the outer
 * move to know).
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

  let errors: Caught | undefined;

  try {
    enter(engine, bearer, from, health, reason);
  } catch (error) {
    errors = caught(errors, error);
  } finally {
    unit.isMoving = false;
  }

  // Each asked-for move is checked when its turn comes: a despawn queued after a revive still despawns, and a revive
  // a death's hook asked for still revives when another of its hooks threw.
  while (unit.nextMoves.length > 0 && !unit.isMoving) {
    const next = unit.nextMoves.shift();

    try {
      if (next !== undefined) {
        moveTo(engine, bearer, next[0], next[1], next[2]);
      }
    } catch (error) {
      errors = caught(errors, error);
    }
  }

  rethrow(errors);

  return true;
};

/** Throws unless a revive's health is absent or a finite number above 0. */
const checkHealth = (health: number | undefined): void => {
  if (health !== undefined && !(Number.isFinite(health) && health > 0)) {
    throw new RangeError(`A unit revives with a finite health above 0; got ${health}.`);
  }
};

/**
 * Runs a move's work and events, the unit in its new state already: what joining life, or leaving it, does, then
 * `changed` (a despawn raises `despawned` in its own work), raised even when the work threw, since the unit moved. The
 * first error surfaces.
 */
const enter = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  from: Lifecycle,
  health: number | undefined,
  reason: string | undefined
): void => {
  const unit = unitOf<G>(bearer);
  const to = unit.lifecycle;
  let errors: Caught | undefined;

  try {
    if (to === 'alive') {
      unit.health = Math.min(health ?? unit.maxHealth, unit.maxHealth);
      rejoinOwner(bearer);
      lifeChanged(engine, bearer, true);
    } else {
      // A kill's health is set before anything hears the death.
      if (health !== undefined) {
        unit.health = clampHealth(health, unit.maxHealth);
      }

      leaveLife(engine, bearer, from, reason);
    }
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    if (to !== 'despawned') {
      raise(engine, engine.options.events?.changed, [bearer, from, to, undefined, '']);
    }
  } catch (error) {
    errors = caught(errors, error);
  }

  rethrow(errors);
};

/**
 * The unit leaves life (its new state set already): a despawn cannot be asked again, so one whose hook throws still has
 * it forgotten and released; a death still stops its brain and script. The first error surfaces.
 */
const leaveLife = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  from: Lifecycle,
  reason: string | undefined
): void => {
  const to = unitOf<G>(bearer).lifecycle;
  let errors: Caught | undefined;

  try {
    leaveFor(engine, bearer, from, to === 'despawned' ? 'despawned' : 'dead');
  } catch (error) {
    errors = caught(errors, error);
  }

  try {
    if (to === 'despawned') {
      despawned(engine, bearer, from, reason ?? 'despawn');
    } else {
      lifeChanged(engine, bearer, false);
    }
  } catch (error) {
    errors = caught(errors, error);
  }

  rethrow(errors);
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
