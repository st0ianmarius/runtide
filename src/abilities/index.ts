/**
 * Abilities (§I.6 Abilities, §II.3.2): buttons over spells. An ability is a spell whose activation is a `button`
 * (its cooldown, cost, rules and the auras it lands, as data); a unit's loadout puts one in each of the game's slots
 * (`defineSlots`), and a press fires them (`abilities.tryActivate`), with each slot's cooldown an aura.
 */

export type { AbilityBearer, AbilityTypes, ButtonRefusal, SlotId } from './ability-types.ts';
export type { ButtonApplyExplanation, ButtonExplanation } from './explain.ts';
export { type LoadoutState, NO_LOADOUT } from './loadout.ts';
export { type AbilityProcKinds, type AbilityProcs, useAbility, type UseAbilityProc } from './procs.ts';
export { defineSlots, MAX_SLOTS, type SlotDef, type SlotTable } from './slots.ts';

export {
  type AbilitySystem,
  type AbilitySystemOptions,
  createAbilitySystem,
  type Equipped,
  type MirrorReads,
  type Press,
} from './system.ts';
