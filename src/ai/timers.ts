import { toId } from '../core/ids.ts';
import { recordOf } from '../core/records.ts';
import type { TimerId } from './ai-types.ts';

/** The most timers a game may declare: each is a slot of every brain. */
export const MAX_TIMERS = 32;

/** The game's timers, by name: `defineTimers(['pick', 'execute', 'raise'])`. */
export interface TimerTable<Name extends string = string> {
  /** The names, in declared order. */
  readonly names: readonly Name[];

  /** Each name's id. */
  readonly id: Readonly<Record<Name, TimerId>>;
}

/**
 * Declares the game's timers (TrinityCore's `EventMap` events), each an id by declared order: every brain
 * holds one slot per timer, so a creature's named timers (`nextExecute`, `nextRaise`, the pick gap) are one table.
 * Throws for a repeated name or more than 32.
 */
export const defineTimers = <const Name extends string>(names: readonly Name[]): TimerTable<Name> => {
  if (new Set(names).size !== names.length) {
    throw new RangeError('The timer names must be distinct.');
  }

  if (names.length > MAX_TIMERS) {
    throw new RangeError(`At most ${MAX_TIMERS} timers; got ${names.length}.`);
  }

  // Built as own data properties, so a name like `__proto__` is a timer like any other, read with `ownValue`.
  const id = recordOf(names, (name) => toId<'timers'>(names.indexOf(name)));

  return Object.freeze({ names: Object.freeze([...names]), id });
};
