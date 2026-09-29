import type { AuraId } from '../auras/index.ts';
import { createRegistry, type Registry } from '../core/index.ts';

/** A slot's definition: the aura its cooldown is (`cooldown.<slot>`, §II.6 S4); a slot with none never cools down. */
export interface SlotDef {
  /** The aura an ability in this slot starts as its cooldown; the slot is ready while its bearer does not hold it. */
  readonly cooldown?: AuraId;
}

/** The most slots a game may declare: a press is a mask with one bit per slot. */
export const MAX_SLOTS = 31;

/** The game's slots, in the order a press fires them: dense ids, one bit each in a press mask. */
export type SlotTable<Name extends string = string> = Registry<'slots', Extract<Name, string>, SlotDef, never, never>;

/**
 * Declares the game's slots (§I.6 Abilities, §II.6 S4) in the order one press fires them, each with the aura its
 * cooldown is: `defineSlots({ dodge: { cooldown: AURAS.id.dodgeCooldown }, skill: { … }, ultimate: { … } })`. A
 * cooldown is per slot, not per ability, so an ability equipped on a cooling slot inherits its cooldown.
 */
export const defineSlots = <const Name extends string>(slots: Readonly<Record<Name, SlotDef>>): SlotTable<Name> => {
  const table = createRegistry(slots, { kind: 'slots' });

  if (table.size > MAX_SLOTS) {
    throw new RangeError(`A game declares at most ${MAX_SLOTS} slots; got ${table.size}.`);
  }

  return table;
};
