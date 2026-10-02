import type { Bitset } from '../core/index.ts';
import { ownValue } from '../core/records.ts';
import type { DamageHost } from '../damage/index.ts';
import type { SpellId } from '../spells/index.ts';
import { type UnitEngine, unitOf } from './engine.ts';
import { clampHealth } from './health.ts';
import { moveTo } from './lifecycle.ts';
import type { UnitTypes } from './unit-types.ts';

/**
 * A unit's maximum health moved: its health follows by the system's policy, held from 0 up to the new maximum. Returns
 * the health after. A game calls it where maximum health can change (an aura landing or leaving, gear), or from a stat
 * watch. A living unit whose health ends at 0 (a maximum folded to 0) is handed to `health.onLethal`, which the game
 * wires to its damage system's `damage.kill` for the death pipeline; without it the unit stays alive at 0.
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
  let health: number;

  if (typeof policy === 'function') {
    health = policy(bearer, before, after);
  } else if (policy === 'keep') {
    health = unit.health;
  } else {
    health = (before > 0 ? unit.health / before : 1) * after;
  }

  unit.health = clampHealth(health, after);

  if (unit.health <= 0 && unit.lifecycle === 'alive') {
    engine.options.health.onLethal?.(bearer);
  }

  return unit.health;
};

/**
 * A damage spell's modifier scopes: the game's `modifiers.scopeOf` when it has one, else the spell registry's tags of
 * a spell id or of a spell name. Throws a `RangeError` for a name the spell registry does not have, and a `TypeError`
 * for a spell of another kind (the game's own records need `scopeOf`).
 */
export const scopeFor = <G extends UnitTypes>(engine: UnitEngine<G>, spell: G['spell']): Bitset | undefined => {
  const scopeOf = engine.options.modifiers?.scopeOf;

  if (scopeOf !== undefined) {
    return scopeOf(spell);
  }

  const { registry } = engine.options.spells;

  if (typeof spell === 'number') {
    return registry.tagSets[spell];
  }

  if (typeof spell !== 'string') {
    throw new TypeError('Unit system: a damage spell that is neither a spell id nor a name needs modifiers.scopeOf.');
  }

  const ids: Readonly<Record<string, SpellId | undefined>> = registry.id;
  const id = ownValue(ids, spell);

  if (id === undefined) {
    throw new RangeError(
      `Unit system: a damage spell named ${spell} is not in the spell registry (modifiers.scopeOf).`
    );
  }

  return registry.tagSets[id];
};

/**
 * The damage host a unit system provides: health (held from 0 up to the unit's maximum), maximum health, stats, ids,
 * and a death that leaves the unit dead. A game spreads it into its damage host and adds the rest.
 */
export const damageHostOf = <G extends UnitTypes>(
  engine: UnitEngine<G>
): Pick<DamageHost<G>, 'health' | 'setHealth' | 'maxHealth' | 'statsOf' | 'idOf' | 'unitOf' | 'remove' | 'isGone'> => ({
  health: (unit) => unitOf<G>(unit).health,
  isGone: (unit) => unitOf<G>(unit).lifecycle !== 'alive',

  setHealth: (unit, health) => {
    const record = unitOf<G>(unit);

    record.health = clampHealth(health, record.maxHealth);
  },

  maxHealth: (unit) => unitOf<G>(unit).maxHealth,

  statsOf: (unit, spell, against) =>
    spell === undefined ? engine.statsOf(unit, against) : engine.statsOf(unit, against, scopeFor(engine, spell)),

  idOf: (unit) => unitOf<G>(unit).id,
  unitOf: (id) => engine.byId.get(id),

  remove: (unit) => {
    moveTo(engine, unit, 'dead');
  }
});
