import { NO_CAST } from '../spells/index.ts';
import { type UnitEngine, unitOf } from './engine.ts';
import { moveTo } from './lifecycle.ts';
import type { UnitTypes } from './unit-types.ts';

/** A spawned unit with an owner joins its owner's summons, last (§I.7.1 F18). */
export const joinOwner = (bearer: UnitTypes['bearer']): void => {
  const { owner } = unitOf<UnitTypes>(bearer);

  if (owner !== undefined) {
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
 * summoned by (§II.6 S6).
 */
export const leaveOwner = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): void => {
  const unit = unitOf<G>(bearer);
  const summons = unit.owner === undefined ? undefined : unitOf<G>(unit.owner).summons;
  const index = summons?.indexOf(bearer) ?? -1;

  if (summons !== undefined && index >= 0) {
    summons.splice(index, 1);
  }

  if (unit.cast !== NO_CAST) {
    engine.options.spells.release(unit.cast);
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
