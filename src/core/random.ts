/**
 * A source of uniform floats in `[0, 1)`: each call is one draw. Sequential streams and keyed sources both have this
 * shape, so the integer helpers (`int`, `pick`, `shuffle`, `weighted`) work on either with the same draw counts.
 */
export type Random = () => number;

/** 2³², the divisor that turns an unsigned 32-bit integer into a float in `[0, 1)`. */
export const UINT32_RANGE = 4_294_967_296;

/**
 * A sequential random stream: Mulberry32 seeded with `seed ^ salt`, reproducing swarm's `rng(seed ^ salt)` draw for
 * draw. Each stream has its own salt, so a roll added to one system never shifts another; within a stream, draws
 * depend on call order. Integer arithmetic only, so every platform draws the same values.
 */
export const stream = (seed: number, salt = 0): Random => {
  let state = seed ^ salt;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let t = Math.imul(state ^ (state >>> 15), 1 | state);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
};
