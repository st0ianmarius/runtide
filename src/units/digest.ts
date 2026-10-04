import { digest } from '../core/digest.ts';
import { type UnitEngine, unitOf } from './engine.ts';
import type { Lifecycle, UnitTypes } from './unit-types.ts';

/** Each lifecycle's number in a digest. */
const LIFECYCLES: Readonly<Record<Lifecycle, number>> = { alive: 0, dead: 1, despawned: 2 };

/**
 * Fills `out` (emptied first) with every live unit, alive and dead, in ascending entity id order; returns how many.
 * The engine keeps them so ordered, so a call sorts nothing and allocates nothing once `out` has grown.
 */
export const listUnits = <G extends UnitTypes>(engine: UnitEngine<G>, out: G['bearer'][]): number => {
  const { ordered } = engine;

  out.length = ordered.length;

  for (let i = 0; i < ordered.length; i++) {
    out[i] = ordered[i] ?? missingUnit();
  }

  return ordered.length;
};

/**
 * Folds every live unit into `hash`, in ascending entity id order: its id, template, side, lifecycle, health, maximum
 * health, owner's id (−1 for none), summon limit and what it counts, and variant index (−1 for none). Allocation-free.
 */
export const digestUnits = <G extends UnitTypes>(engine: UnitEngine<G>, hash: number): number => {
  const { ordered } = engine;
  let next = digest(hash, ordered.length);

  for (const bearer of ordered) {
    const unit = unitOf<G>(bearer);

    next = digest(next, unit.id);
    next = digest(next, unit.template);
    next = digest(next, unit.side);
    next = digest(next, LIFECYCLES[unit.lifecycle]);
    next = digest(next, unit.health);
    next = digest(next, unit.maxHealth);
    next = digest(next, unit.owner?.id ?? -1);
    next = digest(next, unit.perOwner);
    next = digest(next, unit.perOwnerOf === 'any' ? 1 : 0);
    next = digest(next, unit.variant);
  }

  return next;
};

/** A hole in the ordered list: its upkeep prevents it. */
const missingUnit = (): never => {
  throw new Error('Unit system: the ordered unit list has a hole.');
};
