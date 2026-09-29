import type { AbilityBearer, AbilityTypes } from '../abilities/index.ts';
import type { Id } from '../core/index.ts';
import type { DamageTypes } from '../damage/index.ts';
import type { StatSheet } from '../modifiers/index.ts';

/** The id of a unit template: its position in the game's unit registry (`defineUnits`), which is also its wire id. */
export type UnitId = Id<'units'>;

/** The id of a unit class tag: its position in the game's unit tag table (`defineUnitTags`). */
export type UnitTagId = Id<'unitTags'>;

/**
 * Where a unit is in its life (§II.6 U3): `standing`; `downed` (out of the fight, revivable); `dead`; `disconnected`
 * (its player left, the unit stays); `despawned` (removed without dying: no rewards, no kill, no death burst).
 */
export type Lifecycle = 'standing' | 'downed' | 'dead' | 'disconnected' | 'despawned';

/** The lifecycle states, in the code order views and events carry. */
export const LIFECYCLES: readonly Lifecycle[] = Object.freeze([
  'standing',
  'downed',
  'dead',
  'disconnected',
  'despawned',
]);

/**
 * What every unit is (§I.7.1 F13): one shape for heroes, creatures and summons. It bears auras, casts, has a loadout
 * (an empty one for a unit with no buttons) and its own stat sheet; a game's `bearer` is the system's `Unit`.
 */
export interface UnitShape extends AbilityBearer {
  /** Its entity id, unique among live units. */
  readonly id: number;

  /** Its template. */
  readonly template: UnitId;

  /** Its side: 0 or 1, the two sides that fight. */
  readonly side: number;

  /** The unit it belongs to (a summoner, a pet's owner); `undefined` for none. */
  readonly owner: UnitShape | undefined;

  /** Where it is in its life. */
  readonly lifecycle: Lifecycle;

  /** Its health now. */
  readonly health: number;

  /** Its stat sheet, folded by the modifier system; `undefined` for a game without one. */
  readonly sheet: StatSheet | undefined;
}

/**
 * The types one game's units are written against: abilities (and through them spells, procs and auras), damage, and
 * what units name: their templates, class tags and derived states, and the game's own fields on a unit.
 */
export interface UnitTypes extends AbilityTypes, DamageTypes {
  /** A unit: the unit system's `Unit` over the game's types. */
  readonly bearer: UnitShape;

  /** The names of the game's unit templates. */
  readonly unitName: string;

  /** The names of the game's unit class tags (`horde`, `elite`, `boss`, `objective`). */
  readonly unitTag: string;

  /** The names of the game's derived unit states (`stunned`, `rooted`, `frozen`). */
  readonly unitState: string;

  /** The game's own fields on a unit (§I.5.6 hatch 4), made by the system's `createExt`. */
  readonly unitExt: unknown;
}
