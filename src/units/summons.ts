import { NO_CAST } from '../spells/index.ts';
import { lateOf, type UnitEngine, unitOf } from './engine.ts';
import { moveTo } from './lifecycle.ts';
import type { UnitTypes } from './unit-types.ts';

/**
 * A spawned unit with an owner joins what its owner owns and its summons, the owner alive or dead; an owner despawned
 * already lets go of it at once, as its despawn would have.
 */
export const joinOwner = (bearer: UnitTypes['bearer']): void => {
  const unit = unitOf<UnitTypes>(bearer);
  const { owner } = unit;

  if (owner === undefined) {
    return;
  }

  const record = unitOf<UnitTypes>(owner);

  if (record.lifecycle === 'despawned') {
    unit.credit = creditOf(bearer);
    unit.owner = undefined;

    return;
  }

  record.owned.push(bearer);
  record.summons.push(bearer);
};

/** A revived unit joins its owner's summons again, last, if it still has an owner (alive or dead). */
export const rejoinOwner = (bearer: UnitTypes['bearer']): void => {
  const { owner } = unitOf<UnitTypes>(bearer);

  if (owner !== undefined) {
    unitOf<UnitTypes>(owner).summons.push(bearer);
  }
};

/**
 * The entity id a unit's deeds are credited to: its owner's, up the chain, or its own; an orphan's, the owner's it had
 * (a turret its despawned summoner left still credits the summoner).
 */
export const creditOf = (bearer: UnitTypes['bearer']): number => {
  let root = unitOf<UnitTypes>(bearer);

  while (root.owner !== undefined) {
    root = unitOf<UnitTypes>(root.owner);
  }

  return root.credit >= 0 ? root.credit : root.id;
};

/**
 * A unit despawned for good: the units it still owns (the unbound ones, dead or alive) let go of it, so none keeps a unit the game
 * may reuse, and keep crediting its id.
 */
export const orphanSummons = (bearer: UnitTypes['bearer']): void => {
  const { summons, owned } = unitOf<UnitTypes>(bearer);

  for (const summon of owned) {
    const unit = unitOf<UnitTypes>(summon);

    unit.credit = creditOf(summon);
    unit.owner = undefined;
  }

  owned.length = 0;
  summons.length = 0;
};

/** Takes a unit out of a list, keeping the others in order. */
const drop = <Unit>(list: Unit[], unit: Unit): void => {
  const index = list.indexOf(unit);

  if (index >= 0) {
    list.splice(index, 1);
  }
};

/**
 * A unit dies or despawns: it leaves its owner's summons (keeping the others in order), and what its owner owns when it
 * despawns; and it lets go of the cast it was summoned by.
 */
export const leaveOwner = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer'], isGone: boolean): void => {
  const unit = unitOf<G>(bearer);

  if (unit.owner !== undefined) {
    const owner = unitOf<G>(unit.owner);

    drop(owner.summons, bearer);

    if (isGone) {
      drop(owner.owned, bearer);
    }
  }

  if (unit.cast !== NO_CAST) {
    engine.options.spells.unretain(unit.cast);
    unit.cast = NO_CAST;
  }
};

/**
 * A unit dies or despawns: its bound summons despawn with it (reason `owner`), in the order they spawned, dead ones
 * too, so no corpse outlives its owner to be revived bound to nothing.
 */
export const despawnBound = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): void => {
  const { owned } = unitOf<G>(bearer);

  if (owned.length === 0) {
    return;
  }

  despawnFrom(engine, owned.slice(), 0);
};

/** Despawns the bound summons of a list from `start`: one whose hook throws still has the rest go, then it throws. */
const despawnFrom = <G extends UnitTypes>(engine: UnitEngine<G>, summons: readonly G['bearer'][], start: number) => {
  for (let i = start; i < summons.length; i++) {
    const summon = summons[i];

    if (summon === undefined || !unitOf<G>(summon).isBound) {
      continue;
    }

    try {
      moveTo(engine, summon, 'despawned', undefined, 'owner');
    } catch (error) {
      despawnFrom(engine, summons, i + 1);

      throw error;
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
