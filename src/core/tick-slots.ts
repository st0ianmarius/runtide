import type { Id } from './ids.ts';
import { recordOf } from './records.ts';
import { createRegistry, type DefOf, type Registry } from './registry.ts';

/** The id of a tick slot the game declared: where the host steps a group of things inside its own loop. */
export type TickSlotId = Id<'tickSlots'>;

/** A tick slot's definition: a slot is a name and an id, nothing more. */
export type TickSlotDef = Readonly<Record<never, never>>;

/**
 * Declares the game's tick slots as a registry like any other: `defineTickSlots(['movement',
 * 'attack'])` gives `movement` id 0 and `attack` id 1. Stepped things name their slot by id; the host calls the
 * steppers inside its own loops, so the framework never runs a fixed "tick everything" pass.
 */
export const defineTickSlots = <const Name extends string>(
  names: readonly Name[],
): Registry<'tickSlots', Extract<Name, string>, DefOf<Readonly<Record<Name, TickSlotDef>>>, never> =>
  createRegistry(
    recordOf(names, (): TickSlotDef => ({})),
    { kind: 'tickSlots' },
  );
