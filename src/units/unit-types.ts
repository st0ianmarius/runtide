import type { AbilityBearer, AbilityTypes } from '../abilities/index.ts';
import type { AiBearer, AiTypes } from '../ai/index.ts';
import type { Id } from '../core/index.ts';
import type { DamageTypes } from '../damage/index.ts';
import type { StatSheet } from '../modifiers/index.ts';

/** The id of a unit template: its position in the game's unit registry (`defineUnits`), which is also its wire id. */
export type UnitId = Id<'units'>;

/** The id of a unit class tag: its position in the game's unit tag table (`defineUnitTags`). */
export type UnitTagId = Id<'unitTags'>;

/**
 * Where a unit is in its life: `alive`; `dead` (revivable); `despawned` (removed without dying: no rewards,
 * no kill). Going down and a player leaving are the game's own states: auras whose tags a unit state reads.
 */
export type Lifecycle = 'alive' | 'dead' | 'despawned';

/**
 * What every unit is: one shape for heroes, creatures and summons. It bears auras, casts, has a loadout
 * (an empty one for a unit with no buttons) and its own stat sheet; a game's `bearer` is the system's `Unit`.
 */
export interface UnitShape extends AbilityBearer, AiBearer {
  /** Its entity id, unique among live units. */
  readonly id: number;

  /** Its template. */
  readonly template: UnitId;

  /** Its side, which the world's reaction rule reads (`units.setSide` changes it: a charm, a flag for combat). */
  readonly side: number;

  /** The unit it belongs to (a summoner, a pet's owner); `undefined` for none. */
  readonly owner: UnitShape | undefined;

  /** Where it is in its life. */
  readonly lifecycle: Lifecycle;

  /** Its health now. */
  readonly health: number;

  /** Its stat sheet, folded by the modifier system; `undefined` for a game without one. */
  readonly sheet: StatSheet | undefined;

  /** Its record in the script system, which runs its script; −1 for a unit with none. */
  readonly scriptSlot: number;
}

/**
 * The types one game's units are written against: abilities (and through them spells, procs and auras), damage, and
 * what units name: their templates, class tags and derived states, and the game's own fields on a unit.
 */
export interface UnitTypes extends AbilityTypes, AiTypes, DamageTypes {
  /** A unit: the unit system's `Unit` over the game's types. */
  readonly bearer: UnitShape;

  /** The names of the game's unit templates. */
  readonly unitName: string;

  /** The names of the game's unit class tags (`horde`, `elite`, `boss`, `objective`). */
  readonly unitTag: string;

  /** The names of the game's derived unit states (`stunned`, `rooted`, `frozen`). */
  readonly unitState: string;

  /** The game's own fields on a unit, made by the system's `createExt`. */
  readonly unitExt: unknown;

  /** The game's own data on a unit template (`UnitDef.data`: rewards, a roster's rules). */
  readonly unitData: unknown;

  /** The names of the game's scripts (`warden`, `hordeCaster`, `inferno`), which templates and spawns name. */
  readonly scriptName: string;
}
