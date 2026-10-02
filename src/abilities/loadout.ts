import type { AbilityBearer } from './ability-types.ts';

/**
 * What the ability system keeps on a unit (`AbilityBearer.loadout`): the ability in each slot and its rank. It is the
 * system's; a game changes it through `abilities.equip` and reads it through `abilityOf` and `slotOf`.
 */
export interface LoadoutState {
  /** How many slots it has. */
  readonly size: number;
}

/** The loadout's record: one spell id (−1 for an empty slot) and one rank per slot. */
export class LoadoutRecord implements LoadoutState {
  /** The spell in each slot, −1 for none. */
  readonly spells: Int32Array;

  /** The rank of each slot's spell, from 1; 0 for the caster's own (`host.rankOf`, else 1), and for an empty slot. */
  readonly ranks: Uint8Array;

  constructor(size: number) {
    this.spells = new Int32Array(size).fill(-1);
    this.ranks = new Uint8Array(size);
  }

  /** How many slots it has. */
  get size(): number {
    return this.spells.length;
  }
}

/** The loadout of a unit with no buttons (a creature, a wall): no slots, shared, never written. */
export const NO_LOADOUT: LoadoutState = Object.freeze(new LoadoutRecord(0));

/** A unit's loadout record, or a clear error for a unit whose loadout the system did not make. */
export const loadoutOf = (bearer: AbilityBearer): LoadoutRecord => {
  const { loadout } = bearer;

  if (!(loadout instanceof LoadoutRecord)) {
    throw new TypeError('A unit with buttons needs a loadout made by abilities.createLoadout().');
  }

  return loadout;
};
