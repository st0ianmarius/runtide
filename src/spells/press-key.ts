/** The largest press key: the largest whole number a float holds exactly, so keys compare as they count. */
const MAX_PRESS_KEY = Number.MAX_SAFE_INTEGER;

/**
 * A press key, checked: `undefined` (no key) as it is, else a whole number from 1 to 2^53 − 1. Keys count from 1 (0 is
 * no key, so a press keyed 0 would play its cast cue twice: its echo would never be dropped), increase with every press,
 * and never wrap, since a client settles its echoes by comparing keys as numbers and the wire carries anything else
 * as 0. Throws a `RangeError` for any other key.
 */
export const checkPressKey = (key: number | undefined): number | undefined => {
  if (key !== undefined && !(Number.isInteger(key) && key >= 1 && key <= MAX_PRESS_KEY)) {
    throw new RangeError(
      `A press key is a whole number from 1 to 2^53 − 1 (keys count from 1, increase, and never wrap); got ${key}.`
    );
  }

  return key;
};
