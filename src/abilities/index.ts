/**
 * Abilities: buttons over spells. An ability is a spell whose activation is a `button` (its cost, rules, the auras it
 * lands and when a press commits, as data; its cooldowns are its spell's); a unit's loadout puts one in each of the
 * game's slots (`defineSlots`), and a press fires them (`abilities.tryActivate`).
 */

export type { AbilityBearer, AbilityTypes, ButtonRefusal, PressRefusal, SlotId } from './ability-types.ts';

export type { ButtonExplanation } from './explain.ts';
export { type LoadoutState, NO_LOADOUT } from './loadout.ts';
export { defineSlots, MAX_SLOTS, type SlotDef, type SlotTable } from './slots.ts';

export {
  type AbilitySystem,
  type AbilitySystemOptions,
  createAbilitySystem,
  type Equipped,
  type MirrorReads,
  type Press
} from './system.ts';
