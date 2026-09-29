import type { EventKind } from '../core/index.ts';
import type { Vec2 } from '../math/index.ts';
import { type UnitEngine, unitOf } from './engine.ts';
import type { UnitEvent } from './events.ts';
import { despawnBound, leaveOwner } from './summons.ts';
import type { Lifecycle, UnitTypes } from './unit-types.ts';

/**
 * The moves each lifecycle state allows (§II.6 U3): a standing unit goes down, dies, disconnects or despawns; a downed
 * one is revived, dies, disconnects or despawns; a dead one is revived or despawns; a disconnected one comes back
 * standing, or goes down, dies or despawns; a despawned one is gone for good.
 */
const MOVES: Readonly<Record<Lifecycle, readonly Lifecycle[]>> = Object.freeze({
  standing: ['downed', 'dead', 'disconnected', 'despawned'],
  downed: ['standing', 'dead', 'disconnected', 'despawned'],
  dead: ['standing', 'despawned'],
  disconnected: ['standing', 'downed', 'dead', 'despawned'],
  despawned: [],
});

/** Raises a unit event, when something hears it. */
const raise = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  kind: EventKind<UnitEvent<G>> | undefined,
  [unit, from, to, at, reason]: readonly [G['bearer'], Lifecycle, Lifecycle, Vec2 | undefined, string],
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
  at: Vec2 | undefined,
): void => {
  raise(engine, engine.options.events?.spawned, [unit, 'standing', 'standing', at, '']);
};

/** A unit leaves for a state other than `standing`: its casts end if it stood, and it enters the bearer state. */
const leaveFor = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [from, to]: readonly [Lifecycle, Exclude<Lifecycle, 'standing'>],
): void => {
  if (from === 'standing') {
    engine.options.spells.cancelAll(bearer);
  }

  const state = engine.options.lifecycleStates?.[to];

  if (state !== undefined) {
    engine.options.auras.enterState(bearer, state);
  }

  if (to === 'dead' || to === 'despawned') {
    leaveOwner(engine, bearer);
    despawnBound(engine, bearer);
  }
};

/** A unit despawned: its id forgotten, its brain freed, the `despawned` event raised, then its script detached. */
const despawned = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [from, reason]: readonly [Lifecycle, string],
): void => {
  const unit = unitOf<G>(bearer);

  engine.byId.delete(unit.id);
  engine.options.ai?.release(bearer);
  raise(engine, engine.options.events?.despawned, [bearer, from, 'despawned', undefined, reason]);

  if (unit.scriptSlot >= 0) {
    engine.options.scripts?.().detach(bearer);
    unit.scriptSlot = -1;
  }
};

/**
 * Moves a unit to a lifecycle state (§II.6 U3), when its state allows the move: a unit leaving `standing` has every
 * cast it runs cancelled (§I.7.1 F16: a death cancels them, as going down or leaving does) and enters the aura
 * system's matching bearer state (so auras `removedOn` it go); a unit dying or despawning leaves its owner's summons
 * and takes its bound summons along (§I.7.1 F18); a revive sets health (the maximum by default). Raises `changed`, or
 * `despawned` with its reason for a despawn, which also forgets the unit's entity id and frees its brain. False when
 * the move is not allowed.
 */
export const moveTo = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [to, health, reason]: readonly [Lifecycle, number | undefined, string?],
): boolean => {
  const unit = unitOf<G>(bearer);
  const from = unit.lifecycle;

  if (!MOVES[from].includes(to)) {
    return false;
  }

  unit.lifecycle = to;

  if (to === 'standing') {
    if (from === 'downed' || from === 'dead') {
      unit.health = Math.min(health ?? unit.maxHealth, unit.maxHealth);
    }
  } else {
    leaveFor(engine, bearer, [from, to]);
  }

  if (to === 'despawned') {
    despawned(engine, bearer, [from, reason ?? 'despawn']);
  } else {
    raise(engine, engine.options.events?.changed, [bearer, from, to, undefined, '']);
  }

  return true;
};
