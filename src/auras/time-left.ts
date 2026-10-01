// A time change walks the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { AuraItem } from './active-aura.ts';
import type { AuraTagId, AuraTypes } from './aura-types.ts';
import type { AuraEngine } from './engine.ts';
import { type AuraSet, setOf } from './state.ts';

/**
 * Sets an aura's time left without touching its duration (its bar keeps its length, only the time left moves): its
 * stamp. An aura at 0 left runs out on its bearer's next tick.
 */
const setTimeLeft = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  set: AuraSet<G>,
  item: AuraItem<G>,
  seconds: number
): void => {
  item.end = (set.clocks[item.clock] ?? 0) + engine.stepsFor(item, seconds);
  set.noteEnd(item);
};

/**
 * Changes the time left on every finite aura granting a tag (a cooldown's `scale` and `clamp`), keeping
 * each one's duration: `left × factor` (from 0), capped at `cap` (`Infinity` for none). It raises nothing (a cooldown shortened is not a refresh),
 * and counts as a change of the bearer's list for its readers. Returns how many auras it changed.
 */
export const changeTimeLeft = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  tag: AuraTagId,
  factor: number,
  cap: number
): number => {
  if (!(factor >= 0 && Number.isFinite(factor)) || !(cap >= 0)) {
    throw new RangeError(`A time change takes a finite factor and a cap from 0; got ${factor} and ${cap}.`);
  }

  const set = setOf<G>(bearer);
  let changed = 0;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item !== undefined && item.end !== Infinity && engine.tables.tagBits[item.id]?.has(tag) === true) {
      const left = engine.remainingOf(set, item);
      const next = Math.min(left * factor, cap);

      if (next !== left) {
        setTimeLeft(engine, set, item, next);
        changed += 1;
      }
    }
  }

  if (changed > 0) {
    set.changes += 1;
  }

  return changed;
};
