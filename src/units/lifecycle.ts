import type { EventKind } from '../core/index.ts';
import { type UnitEngine, type UnitEvent, unitOf } from './engine.ts';
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
  [unit, from, to]: readonly [G['bearer'], Lifecycle, Lifecycle],
): void => {
  const bus = engine.options.events?.bus;

  if (bus === undefined || kind === undefined || !bus.hears(kind)) {
    return;
  }

  const payload = bus.payload(kind);

  payload.unit = unit;
  payload.from = from;
  payload.to = to;
  bus.raise(kind, payload);
  payload.unit = undefined;
};

/** Raises a unit's spawn event. */
export const raiseSpawned = <G extends UnitTypes>(engine: UnitEngine<G>, unit: G['bearer']): void => {
  raise(engine, engine.options.events?.spawned, [unit, 'standing', 'standing']);
};

/**
 * Moves a unit to a lifecycle state (§II.6 U3), when its state allows the move: enters the aura system's matching
 * bearer state (so auras `removedOn` it go), sets health (a revive's, the maximum by default), and raises `changed`,
 * or `despawned` for a despawn, which also forgets the unit's entity id. False when the move is not allowed.
 */
export const moveTo = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  bearer: G['bearer'],
  [to, health]: readonly [Lifecycle, number | undefined],
): boolean => {
  const unit = unitOf<G>(bearer);
  const from = unit.lifecycle;

  if (!MOVES[from].includes(to)) {
    return false;
  }

  unit.lifecycle = to;

  if (to === 'standing' && (from === 'downed' || from === 'dead')) {
    unit.health = Math.min(health ?? unit.maxHealth, unit.maxHealth);
  }

  const state = to === 'standing' ? undefined : engine.options.lifecycleStates?.[to];

  if (state !== undefined) {
    engine.options.auras.enterState(bearer, state);
  }

  if (to === 'despawned') {
    engine.byId.delete(unit.id);
    raise(engine, engine.options.events?.despawned, [bearer, from, to]);
  } else {
    raise(engine, engine.options.events?.changed, [bearer, from, to]);
  }

  return true;
};
