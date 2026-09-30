import type { EventKind } from '../core/index.ts';
import type { Vec2 } from '../math/index.ts';
import { lateOf, type UnitEngine, unitOf } from './engine.ts';
import type { UnitEvent } from './events.ts';
import { adoptSummons, despawnBound, leaveOwner, orphanSummons, rejoinOwner } from './summons.ts';
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
 * hear it, then those `removedOn` it go), and it leaves its owner's summons, taking its bound ones along.
 */
const leaveFor = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [from, to]: readonly [Lifecycle, Exclude<Lifecycle, 'alive'>]
): void => {
  if (from === 'alive') {
    engine.options.spells.cancelAll(bearer);
  }

  const { auras } = engine.options;

  if (auras.hasState(to)) {
    auras.enterState(bearer, to);
  }

  leaveOwner(engine, bearer, to === 'despawned');
  despawnBound(engine, bearer);
};

/**
 * A unit despawned: its id forgotten, its brain freed, the `despawned` event raised, then its script detached and its
 * auras released to their pool.
 */
const despawned = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [from, reason]: readonly [Lifecycle, string]
): void => {
  const unit = unitOf<G>(bearer);

  engine.byId.delete(unit.id);
  orphanSummons(bearer);
  engine.options.ai?.release(bearer);
  raise(engine, engine.options.events?.despawned, [bearer, from, 'despawned', undefined, reason]);

  if (unit.scriptSlot >= 0 && engine.options.scripts !== undefined) {
    lateOf(engine.options.scripts).detach(bearer);
  }

  unit.scriptSlot = -1;
  engine.options.auras.release(bearer);
};

/**
 * Moves a unit to a lifecycle state, when its state allows the move: a unit leaving life has every cast it
 * runs cancelled, enters the aura system's matching bearer state (its auras' `onState`, then those
 * `removedOn` it go: a death burst is an aura's `onState` of `dead`), leaves its owner's summons and takes its bound
 * summons along; a revive sets health (the maximum by default) and rejoins its owner's summons, if its owner lives. Raises `changed`, or `despawned` with its
 * reason for a despawn, which also forgets the unit's entity id and frees its brain. A move asked for from its hooks or
 * events (a revive from a death's `onState`) waits until this one is done, so its events follow this one's; such
 * moves run in the order asked, each checked when its turn comes. False when the move is not allowed.
 */
export const moveTo = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [to, health, reason]: readonly [Lifecycle, number | undefined, (string | undefined)?]
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
    enter(engine, bearer, [from, to, health, reason]);
  } finally {
    unit.isMoving = false;
  }

  // Each asked-for move is checked when its turn comes: a despawn queued after a revive still despawns.
  while (unit.nextMoves.length > 0 && !unit.isMoving) {
    const next = unit.nextMoves.shift();

    if (next !== undefined) {
      moveTo(engine, bearer, next);
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

/** Runs a move's work and events: what joining life, or leaving it, does. */
const enter = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [from, to, health, reason]: readonly [Lifecycle, Lifecycle, number | undefined, string | undefined]
): void => {
  const unit = unitOf<G>(bearer);

  if (to === 'alive') {
    unit.health = Math.min(health ?? unit.maxHealth, unit.maxHealth);
    rejoinOwner(bearer);
    adoptSummons(bearer);
  } else {
    leaveFor(engine, bearer, [from, to]);
  }

  if (to === 'despawned') {
    despawned(engine, bearer, [from, reason ?? 'despawn']);
  } else {
    raise(engine, engine.options.events?.changed, [bearer, from, to, undefined, '']);
  }
};
