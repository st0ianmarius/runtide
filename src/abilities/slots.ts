import { createRegistry, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** A slot's definition: nothing of its own yet; a slot is its name and its place in the press order. */
export type SlotDef = Readonly<Record<string, never>>;

/** The most slots a game may declare: a press is a mask with one bit per slot. */
export const MAX_SLOTS = 31;

/** The game's slots, in the order a press fires them: dense ids, one bit each in a press mask. */
export type SlotTable<Name extends string = string> = Registry<'slots', Extract<Name, string>, SlotDef, never>;

/**
 * Declares the game's slots in the order one press fires them: `defineSlots(['dodge', 'skill', 'ultimate'])`. A slot
 * holds a button spell and nothing else: its cooldowns are the spell's own (shared through a common aura when the game
 * wants a slot-wide one).
 */
export const defineSlots = <const Name extends string>(names: readonly Name[]): SlotTable<Name> => {
  const none: SlotDef = Object.freeze({});

  const table = createRegistry(
    recordOf(names, () => none),
    { kind: 'slots' },
  );

  if (table.size > MAX_SLOTS) {
    throw new RangeError(`A game declares at most ${MAX_SLOTS} slots; got ${table.size}.`);
  }

  return table;
};
