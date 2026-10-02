import type { Defined } from './defined.ts';
import type { Random } from './random.ts';

/**
 * A uniform integer in `[0, n)`: one draw, `floor(random() × n)`. Throws a `RangeError`, without drawing, unless `n`
 * is a whole number from 1.
 */
export const int = (random: Random, n: number): number => {
  if (!(Number.isSafeInteger(n) && n > 0)) {
    throw new RangeError(`int draws below a whole number from 1; got ${n}.`);
  }

  return Math.floor(random() * n);
};

/** A uniform element of a non-empty list: one draw. Throws, without drawing, on an empty list. */
export const pick = <Item extends Defined>(random: Random, list: readonly Item[]): Item => {
  const item = list.length > 0 ? list[int(random, list.length)] : undefined;

  if (item === undefined) {
    throw new RangeError('pick needs a non-empty list.');
  }

  return item;
};

/**
 * Shuffles `items` in place by Fisher-Yates from the end: for each index `i` from the last down to 1, one draw picks
 * `j = int(random, i + 1)` and swaps the two, so `n` items take `n − 1` draws. Returns the same array.
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
 * The index of a weighted choice: one draw scaled by the sum of the positive weights, then walked down the list,
 * subtracting each positive weight until the rest falls below zero. Non-positive weights are never chosen, and float
 * slack past the last entry lands on the last entry with a positive weight. Returns -1, without drawing, when no
 * weight is positive.
 */
export const weighted = (random: Random, weights: readonly number[]): number => {
  let total = 0;
  let last = -1;

  // An indexed loop: an AI pick draws here, and an entries iterator allocates.
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index] ?? 0;

    if (weight > 0) {
      total += weight;
      last = index;
    }
  }

  if (last < 0) {
    return -1;
  }

  let left = random() * total;

  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index] ?? 0;

    if (weight > 0) {
      left -= weight;

      if (left < 0) {
        return index;
      }
    }
  }

  return last;
};
