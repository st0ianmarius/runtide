import { type Random, UINT32_RANGE } from './random.ts';

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

/**
 * The hash the chain starts from. Not zero: `fmix32(0)` is 0, so from zero a run of zero parts would fold to nothing
 * and `(seed 0, salt 0, key [5])` would roll like `(seed 0, salt 5)`.
 */
const START = 0x9e3779b9;

/** The smallest key part accepted: the lowest signed 32-bit integer. */
const MIN_PART = -2_147_483_648;

/** The largest key part accepted: the highest unsigned 32-bit integer. */
const MAX_PART = 4_294_967_295;

/** Murmur3's per-block scramble of one 32-bit integer. */
const scramble = (k: number): number => {
  const h = Math.imul(k, C1);

  return Math.imul((h << 15) | (h >>> 17), C2);
};

/** Murmur3's 32-bit finalizer (`fmix32`): full avalanche over the 32 bits. */
const fmix32 = (value: number): number => {
  let h = value ^ (value >>> 16);

  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);

  return h ^ (h >>> 16);
};

/** Rejects a key part that is not an integer representable in 32 bits (signed or unsigned). */
const checkPart = (part: number): number => {
  if (!Number.isInteger(part) || part < MIN_PART || part > MAX_PART) {
    throw new RangeError(`A keyed roll takes 32-bit integers only; got ${part}.`);
  }

  return part;
};

/** Folds one part into the running hash: `h = fmix32(h ^ mix(part))`, `mix` being Murmur3's block scramble. */
const fold = (h: number, part: number): number => fmix32(h ^ scramble(checkPart(part)));

/**
 * The keyed roll with its key as one array, for hot paths that reuse a scratch key instead of spreading arguments.
 * Same result as `roll(seed, salt, ...key)`.
 */
export const rollKey = (seed: number, salt: number, key: readonly number[]): number => {
  let h = fold(fold(START, seed), salt);

  for (const part of key) {
    h = fold(h, part);
  }

  return (h >>> 0) / UINT32_RANGE;
};

/**
 * A keyed roll: a float in `[0, 1)` that depends only on the run's seed, the stream's salt and the key (integers the
 * simulation owns, such as tick, caster id, spell id, target id and hit index), never on how many rolls came before.
 * A Murmur3-finalizer chain over 32-bit integers (§I.9 decision 6), identical on every platform. Throws a
 * `RangeError` for a part that is not a 32-bit integer. Frozen: the unit tests hold a literal table of its results.
 */
export const roll = (seed: number, salt: number, ...key: readonly number[]): number => rollKey(seed, salt, key);

/**
 * A keyed source for the integer helpers: its `i`-th draw is `roll(seed, salt, ...key, i)`, so `shuffle` or
 * `weighted` over a keyed key draws exactly as many values as over a sequential stream, and switching between the two
 * kinds is a one-line change. The key is copied, so the caller may reuse its array.
 */
export const keyed = (seed: number, salt: number, key: readonly number[]): Random => {
  const parts = [...key, 0];
  const last = key.length;
  let index = 0;

  return () => {
    parts[last] = index;
    index += 1;

    return rollKey(seed, salt, parts);
  };
};
