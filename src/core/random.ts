/**
 * A source of uniform floats in `[0, 1)`: each call is one draw. Sequential streams and keyed sources both have this
 * shape, so the integer helpers (`int`, `pick`, `shuffle`, `weighted`) work on either with the same draw counts.
 */
export type Random = () => number;

/** 2³², the divisor that turns an unsigned 32-bit integer into a float in `[0, 1)`. */
export const UINT32_RANGE = 4_294_967_296;

/**
 * A sequential random stream: Mulberry32 seeded with the 32-bit `seed ^ salt` (so `stream(seed, salt)` and
 * `stream(seed ^ salt)` draw the same sequence), one 32-bit output per draw divided by 2³². Each system draws from its
 * own salt, so a roll added to one system never shifts another; within a stream, draws depend on call order. Integer
 * arithmetic only, so every platform draws the same values. The generator is frozen: its tests hold a literal table.
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

/** A sequential stream whose state can be saved and restored: a checkpoint, a replay, a rollback. */
export interface SavableStream {
  /** One draw. */
  readonly random: Random;

  /** Its state now: a whole number, which `restore` takes back. */
  readonly save: () => number;

  /** Puts it back to a saved state, so it draws on from there. */
  readonly restore: (state: number) => void;
}

/** A sequential stream (`stream(seed, salt)`, draw for draw) whose state can be saved and restored. */
export const savableStream = (seed: number, salt = 0): SavableStream => {
  let state = seed ^ salt;

  return Object.freeze({
    random: (): number => {
      state = (state + 0x6d2b79f5) | 0;

      let t = Math.imul(state ^ (state >>> 15), 1 | state);

      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

      return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
    },

    save: (): number => state,

    restore: (saved: number): void => {
      if (!Number.isInteger(saved)) {
        throw new RangeError(`A stream restores a whole-number state; got ${saved}.`);
      }

      state = saved | 0;
    },
  });
};
