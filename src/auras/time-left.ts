// A time change walks the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { AuraItem } from './active-aura.ts';
import type { AuraTagId, AuraTypes } from './aura-types.ts';
import type { AuraEngine } from './engine.ts';
import { type AuraSet, setOf } from './state.ts';

/** How a time change reads the seconds an aura has left: scaled by a factor, or capped at a most. */
export interface TimeChange {
  /** What the seconds left are multiplied by, from 0. */
  readonly factor: number;

  /** The most seconds left; `Infinity` for no cap. */
  readonly cap: number;
}

/**
 * Sets an aura's time left without touching its duration (its bar keeps its length, only the time left moves): its
 * stamp. An aura at 0 left runs out on its bearer's next tick.
 */
const setTimeLeft = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  [set, item]: readonly [AuraSet<G>, AuraItem<G>],
  seconds: number,
): void => {
  item.end = (set.clocks[item.clock] ?? 0) + engine.stepsFor(item, seconds);
};

/**
 * Changes the time left on every finite aura granting a tag (§II.6 P3: a cooldown's `scale` and `clamp`), keeping
 * each one's duration: `left × factor`, capped at `cap`. It raises nothing (a cooldown shortened is not a refresh),
 * and counts as a change of the bearer's list for its readers. Returns how many auras it changed.
 */
export const changeTimeLeft = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  [bearer, tag]: readonly [G['bearer'], AuraTagId],
  change: TimeChange,
): number => {
  if (!(change.factor >= 0) || !(change.cap >= 0)) {
    throw new RangeError(`A time change takes a factor and a cap from 0; got ${change.factor} and ${change.cap}.`);
  }

  const set = setOf<G>(bearer);
  let changed = 0;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item !== undefined && item.end !== Infinity && engine.tables.tagBits[item.id]?.has(tag) === true) {
      const left = engine.remainingOf(set, item);
      const next = Math.min(left * change.factor, change.cap);

      if (next !== left) {
        setTimeLeft(engine, [set, item], next);
        changed += 1;
      }
    }
  }

  if (changed > 0) {
    set.changes += 1;
  }

  return changed;
};
