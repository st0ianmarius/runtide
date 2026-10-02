/**
 * A source of uniform floats in `[0, 1)`: each call is one draw. Sequential streams and keyed sources both have this
 * shape, so the integer helpers (`int`, `pick`, `shuffle`, `weighted`) work on either with the same draw counts.
 */
export type Random = () => number;

/** 2³², the divisor that turns an unsigned 32-bit integer into a float in `[0, 1)`. */
export const UINT32_RANGE = 4_294_967_296;

/**
 * Throws unless a seed or salt is a 32-bit integer (signed or unsigned), which every stream and keyed roll takes
 * whole: a wall-clock seed (`Date.now()`) would be cut to its low 32 bits by one and refused by the other mid-run.
 */
export const checkSeed = (value: number, what: string): number => {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 4_294_967_295) {
    throw new RangeError(`A ${what} is a 32-bit integer; got ${value}.`);
  }

  return value;
};

/**
 * Folds any finite number (a wall-clock `Date.now()`, a 64-bit id read as a float) into an unsigned 32-bit seed that
 * `checkSeed` accepts: its low 32 bits XORed with the bits above them, so both halves count. A fraction is dropped.
 * Throws a `RangeError` for NaN or an infinity.
 */
export const foldSeed = (n: number): number => {
  if (!Number.isFinite(n)) {
    throw new RangeError(`A seed folds from a finite number; got ${n}.`);
  }

  return (n ^ Math.floor(n / UINT32_RANGE)) >>> 0;
};

/**
 * A sequential random stream: Mulberry32 seeded with the 32-bit `seed ^ salt`, one 32-bit output per draw divided by
 * 2³². Seed and salt combine by XOR alone, so any two pairs with the same XOR draw the same sequence (`stream(5, 3)`
 * is `stream(6, 0)`): within one seed distinct salts never meet, but with small salts the next seed draws this seed's
 * streams under swapped salts. A game hashes its salts (each a hash of its system's name, fixed in source, so they lie
 * far apart in 32 bits), or draws keyed rolls, which hash seed and salt apart. Each system draws from its own salt, so
 * a roll added to one system never shifts another; within a stream, draws depend on call order. Integer arithmetic
 * only, so every platform draws the same values. The generator is frozen: its tests hold a literal table.
 */
export const stream = (seed: number, salt = 0): Random => {
  let state = checkSeed(seed, 'seed') ^ checkSeed(salt, 'salt');

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
  let state = checkSeed(seed, 'seed') ^ checkSeed(salt, 'salt');

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
    }
  });
};
