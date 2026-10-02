import { foldWord } from './keyed-roll.ts';

/**
 * The hash a digest starts from: the golden-ratio constant keyed rolls start from too. Not zero, since a run of zero
 * words would fold from zero to nothing.
 */
export const DIGEST_START = 0x9e_37_79_b9;

/** The low word of the quiet NaN every NaN folds as, since a NaN's own bits may differ by platform. */
const NAN_LOW = 0;

/** The high word of that quiet NaN. */
const NAN_HIGH = 0x7f_f8_00_00;

/** The eight bytes a number's float bits are read through, little-endian, so every platform reads the same words. */
const bits = new DataView(new ArrayBuffer(8));

/**
 * Folds one number into a running 32-bit hash: its float64 bits as two 32-bit words, low word first, read
 * little-endian, each folded by the Murmur3 scramble and finalizer keyed rolls use, so a change in any bit reaches
 * every bit of the hash (two sign flips do not cancel out). Exact: `0` and `-0` differ, as do any two floats an ulp
 * apart, while every NaN folds alike. A 32-bit hash for spotting a desync, not for security: two states that differ
 * slip past with odds of about one in 2³². Start from `DIGEST_START`.
 */
export const digest = (hash: number, value: number): number => {
  let low = NAN_LOW;
  let high = NAN_HIGH;

  if (!Number.isNaN(value)) {
    bits.setFloat64(0, value, true);
    low = bits.getUint32(0, true);
    high = bits.getUint32(4, true);
  }

  return foldWord(foldWord(hash, low), high) >>> 0;
};

/**
 * The digest of a list of numbers in order, from `hash` (`DIGEST_START` by default, or a digest so far to go on
 * from): a game's snapshot checksum, folded over its state tables (healths, positions, timers) in a fixed order, so
 * two peers, or a replay and its recording, compare one 32-bit number per tick and find the first tick they part. The
 * same on every platform.
 */
export const digestOf = (values: Iterable<number>, hash = DIGEST_START): number => {
  let next = hash;

  for (const value of values) {
    next = digest(next, value);
  }

  return next;
};
