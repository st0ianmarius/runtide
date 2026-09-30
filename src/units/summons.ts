import { NO_CAST } from '../spells/index.ts';
import { lateOf, type UnitEngine, unitOf } from './engine.ts';
import { moveTo } from './lifecycle.ts';
import type { UnitTypes } from './unit-types.ts';

/** A spawned unit with an owner joins its owner's summons, last. */
export const joinOwner = (bearer: UnitTypes['bearer']): void => {
  const { owner } = unitOf<UnitTypes>(bearer);

  if (owner !== undefined) {
    unitOf<UnitTypes>(owner).summons.push(bearer);
  }
};

/** A revived unit joins its owner's summons again, last, if its owner is still alive. */
export const rejoinOwner = (bearer: UnitTypes['bearer']): void => {
  const { owner } = unitOf<UnitTypes>(bearer);

  if (owner !== undefined && unitOf<UnitTypes>(owner).lifecycle === 'alive') {
    unitOf<UnitTypes>(owner).summons.push(bearer);
  }
};

/** The entity id a unit's deeds are credited to: its owner's, up the chain, or its own. */
export const creditOf = (bearer: UnitTypes['bearer']): number => {
  let root = unitOf<UnitTypes>(bearer);

  while (root.owner !== undefined) {
    root = unitOf<UnitTypes>(root.owner);
  }

  return root.id;
};

/**
 * A unit dies or despawns: it leaves its owner's summons (keeping the others in order), and lets go of the cast it was
 * summoned by.
 */
export const leaveOwner = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): void => {
  const unit = unitOf<G>(bearer);
  const summons = unit.owner === undefined ? undefined : unitOf<G>(unit.owner).summons;
  const index = summons?.indexOf(bearer) ?? -1;

  if (summons !== undefined && index >= 0) {
    summons.splice(index, 1);
  }

  if (unit.cast !== NO_CAST) {
    engine.options.spells.unretain(unit.cast);
    unit.cast = NO_CAST;
  }
};

/** A unit dies or despawns: its bound summons despawn with it (reason `owner`), in the order they spawned. */
export const despawnBound = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): void => {
  const { summons } = unitOf<G>(bearer);

  if (summons.length === 0) {
    return;
  }

  for (const summon of summons.slice()) {
    if (unitOf<G>(summon).isBound) {
      moveTo(engine, summon, ['despawned', undefined, 'owner']);
    }
  }
};

/** A spawned unit is attached to the script its spawn names, else its template's. */
export const attachScript = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  [bearer, own]: readonly [G['bearer'], G['scriptName'] | undefined]
): void => {
  const unit = unitOf<G>(bearer);
  const script = own ?? engine.registry.defs[unit.template]?.script;

  if (script === undefined) {
    return;
  }

  const scripts = lateOf(engine.options.scripts ?? noScripts);

  unit.scriptSlot = scripts.attach(bearer, script);
  scripts.start(bearer);
};

/** A template names a script, but the unit system has no script system. */
const noScripts = (): never => {
  throw new TypeError('A unit template names a script, so the unit system needs scripts.');
};
