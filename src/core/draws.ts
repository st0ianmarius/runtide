import type { Defined } from './defined.ts';
import type { Random } from './random.ts';

/** A uniform integer in `[0, n)`: one draw, `floor(random() × n)`. */
export const int = (random: Random, n: number): number => Math.floor(random() * n);

/** A uniform element of a non-empty list: one draw. Throws, without drawing, on an empty list. */
export const pick = <Item extends Defined>(random: Random, list: readonly Item[]): Item => {
  const item = list.length > 0 ? list[int(random, list.length)] : undefined;

  if (item === undefined) {
    throw new RangeError('pick needs a non-empty list.');
  }

  return item;
};

/**
 * Shuffles `items` in place by Fisher-Yates from the end, as swarm's wave director and pact hand do: `n − 1` draws for
 * `n` items. Returns the same array.
 */
export const shuffle = <Item extends Defined>(random: Random, items: Item[]): Item[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = int(random, i + 1);
    const a = items[i];
    const b = items[j];

    if (a !== undefined && b !== undefined) {
      items[i] = b;
      items[j] = a;
    }
  }

  return items;
};

/**
 * The index of a weighted choice: one draw scaled by the total weight, walked down the list, as swarm's event picker
 * does. Float slack past the last entry lands on the last entry with a positive weight. Returns -1, without drawing,
 * when no weight is positive.
 */
export const weighted = (random: Random, weights: readonly number[]): number => {
  let total = 0;
  let last = -1;

  for (const [index, weight] of weights.entries()) {
    if (weight > 0) {
      total += weight;
      last = index;
    }
  }

  if (last < 0) {
    return -1;
  }

  let left = random() * total;

  for (const [index, weight] of weights.entries()) {
    if (weight > 0) {
      left -= weight;

      if (left < 0) {
        return index;
      }
    }
  }

  return last;
};
