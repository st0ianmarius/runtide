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
};

/**
 * Moves a unit to a lifecycle state (§II.6 U3), when its state allows the move: a unit leaving `standing` has every
 * cast it runs cancelled (§I.7.1 F16: a death cancels them, as going down or leaving does) and enters the aura
 * system's matching bearer state (so auras `removedOn` it go); a revive sets health (the maximum by default). Raises
 * `changed`, or `despawned` for a despawn, which also forgets the unit's entity id and frees its brain. False when the move is not allowed.
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

  if (to === 'standing') {
    if (from === 'downed' || from === 'dead') {
      unit.health = Math.min(health ?? unit.maxHealth, unit.maxHealth);
    }
  } else {
    leaveFor(engine, bearer, [from, to]);
  }

  if (to === 'despawned') {
    engine.byId.delete(unit.id);
    engine.options.ai?.release(bearer);
    raise(engine, engine.options.events?.despawned, [bearer, from, to]);
  } else {
    raise(engine, engine.options.events?.changed, [bearer, from, to]);
  }

  return true;
};
