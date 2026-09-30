import type { DamageHost } from '../damage/index.ts';
import { lateOf, type UnitEngine, unitOf } from './engine.ts';
import { moveTo } from './lifecycle.ts';
import type { UnitTypes } from './unit-types.ts';

/**
 * A unit's maximum health moved: its health follows by the system's policy. Returns the health after. A
 * game calls it where maximum health can change (an aura landing or leaving, gear), or from a stat watch.
 */
export const syncHealth = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): number => {
  const unit = unitOf<G>(bearer);
  const before = unit.maxHealth;
  const after = engine.statsOf(bearer).total(engine.healthStat);

  if (after === before) {
    return unit.health;
  }

  unit.maxHealth = after;

  const policy = engine.options.health.policy ?? 'heal-gain-scale-loss';
  const share = before > 0 ? unit.health / before : 1;

  if (typeof policy === 'function') {
    unit.health = Math.min(policy(bearer, before, after), after);
  } else if (policy === 'keep') {
    unit.health = Math.min(unit.health, after);
  } else if (policy === 'scale' || after < before) {
    unit.health = share * after;
  } else if (engine.options.damage === undefined) {
    unit.health = Math.min(unit.health + (after - before), after);
  } else {
    lateOf(engine.options.damage).heal({ target: bearer, amount: after - before });
  }

  return unit.health;
};

/**
 * The damage host a unit system provides: health, maximum health, stats, ids, and a death that leaves the unit
 * dead. A game spreads it into its damage host and adds the rest.
 */
export const damageHostOf = <G extends UnitTypes>(
  engine: UnitEngine<G>,
): Pick<DamageHost<G>, 'health' | 'setHealth' | 'maxHealth' | 'statsOf' | 'idOf' | 'unitOf' | 'remove'> => ({
  health: (unit) => unitOf<G>(unit).health,

  setHealth: (unit, health) => {
    unitOf<G>(unit).health = health;
  },

  maxHealth: (unit) => unitOf<G>(unit).maxHealth,
  statsOf: (unit) => engine.statsOf(unit),
  idOf: (unit) => unitOf<G>(unit).id,
  unitOf: (id) => engine.byId.get(id),

  remove: (unit) => {
    moveTo(engine, unit, ['dead', undefined]);
  },
});
