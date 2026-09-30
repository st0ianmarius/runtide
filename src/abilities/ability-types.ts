import type { Id } from '../core/index.ts';
import type { CastRefusal, SpellCaster, SpellTypes } from '../spells/index.ts';
import type { LoadoutState } from './loadout.ts';

/** The id of a slot: its position in the game's slot table (`defineSlots`), which is also its bit in a press mask. */
export type SlotId = Id<'slots'>;

/**
 * Why the ability in a slot may not fire (`abilities.check`): the slot holds none, one of its spell's cooldowns runs,
 * a `requires` tag is missing, a `blockedBy` tag is held, or its cost is not affordable; and, as a press fires it, its
 * `checkCast` said no (`check`), or a prediction mirror leaves it to the server (`server`: a button that commits on its
 * cast, with no `checkCast` to judge it by).
 */
export type ButtonRefusal = 'empty' | 'cooldown' | 'requires' | 'blocked' | 'cost' | 'check' | 'server';

/** Why a pressed slot did not fire, or why its committed cast was refused: the button's reason, or the cast order's. */
export type PressRefusal<G extends SpellTypes> = ButtonRefusal | CastRefusal<G>;

/**
 * A unit with buttons: a caster that also holds a loadout (`abilities.createLoadout()`), where the ability system
 * keeps which ability sits in each slot, so every per-unit read is a field read.
 */
export interface AbilityBearer extends SpellCaster {
  /** The unit's loadout, made by the ability system; the game changes it through `abilities.equip`. */
  readonly loadout: LoadoutState;
}

/**
 * The types one game's abilities are written against: the spell types, a bearer with a loadout, and the names of the
 * game's slots (`dodge`, `skill`, `ultimate`).
 */
export interface AbilityTypes extends SpellTypes {
  /** What casts spells and presses buttons. */
  readonly bearer: AbilityBearer;

  /** The names of the game's slots. */
  readonly slot: string;
}
