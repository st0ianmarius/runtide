import type { DamageHost } from '../damage/index.ts';
import { type UnitEngine, unitOf } from './engine.ts';
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

  const policy = engine.options.health.policy ?? 'scale';

  if (typeof policy === 'function') {
    unit.health = Math.min(policy(bearer, before, after), after);
  } else if (policy === 'keep') {
    unit.health = Math.min(unit.health, after);
  } else {
    unit.health = (before > 0 ? unit.health / before : 1) * after;
  }

  return unit.health;
};

/**
 * The damage host a unit system provides: health, maximum health, stats, ids, and a death that leaves the unit
 * dead. A game spreads it into its damage host and adds the rest.
 */
export const damageHostOf = <G extends UnitTypes>(
  engine: UnitEngine<G>
): Pick<DamageHost<G>, 'health' | 'setHealth' | 'maxHealth' | 'statsOf' | 'idOf' | 'unitOf' | 'remove' | 'isGone'> => ({
  health: (unit) => unitOf<G>(unit).health,
  isGone: (unit) => unitOf<G>(unit).lifecycle !== 'alive',

  setHealth: (unit, health) => {
    unitOf<G>(unit).health = health;
  },

  maxHealth: (unit) => unitOf<G>(unit).maxHealth,
  statsOf: (unit, spell, against) => {
    if (spell === undefined) {
      return engine.statsOf(unit, against);
    }

    const scopeOf = engine.options.modifiers?.scopeOf;

    if (scopeOf !== undefined) {
      return engine.statsOf(unit, against, scopeOf(spell));
    }

    return engine.statsOf(
      unit,
      against,
      typeof spell === 'number' ? engine.options.spells.registry.tagSets[spell] : undefined
    );
  },
  idOf: (unit) => unitOf<G>(unit).id,
  unitOf: (id) => engine.byId.get(id),

  remove: (unit) => {
    moveTo(engine, unit, 'dead');
  }
});
