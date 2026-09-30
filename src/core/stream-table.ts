import { keyed } from './keyed-roll.ts';
import { type Random, stream } from './random.ts';

/** How one named stream draws: a sequential stream (call order matters) or keyed rolls (only the key matters). */
export interface StreamSpec {
  /** `sequential` for a salted Mulberry32 stream, `keyed` for keyed rolls under the same salt. */
  readonly kind: 'sequential' | 'keyed';

  /** The salt mixed with the run's seed; sequential names with the same salt share one stream. */
  readonly salt: number;
}

/**
 * The host's stream table: every named stream a hook may ask for, resolved to a sequential stream or
 * to keyed rolls. Sequential names with the same salt share one stream, so their draws interleave in call order as one
 * sequence; keyed names draw only from their key, so adding or reordering rolls elsewhere shifts nothing.
 */
export interface StreamTable<Name extends string> {
  /** The run's seed every stream is built from. */
  readonly seed: number;

  /**
   * The draw source for `name`. A sequential name returns its shared stream and ignores `key`. A keyed name returns a
   * fresh source whose draws are keyed rolls over `key` plus a draw index, and throws when `key` is missing.
   */
  readonly random: (name: Name, key?: readonly number[]) => Random;
}

/** Builds the stream table for one run from its seed and the game's specs, one entry per name. */
export const createStreamTable = <const Specs extends Readonly<Record<string, StreamSpec>>>(
  seed: number,
  specs: Specs,
): StreamTable<Extract<keyof Specs, string>> => {
  const shared = new Map<number, Random>();
  const sequential = new Map<string, Random>();

  for (const [name, spec] of Object.entries(specs)) {
    if (spec.kind === 'sequential') {
      const existing = shared.get(spec.salt) ?? stream(seed, spec.salt);

      shared.set(spec.salt, existing);
      sequential.set(name, existing);
    }
  }

  return {
    seed,

    random: (name, key) => {
      const found = sequential.get(name);

      if (found !== undefined) {
        return found;
      }

      const spec = specs[name];

      if (spec === undefined || key === undefined) {
        throw new RangeError(`Stream ${name} is ${spec === undefined ? 'not in the table' : 'keyed and needs a key'}.`);
      }

      return keyed(seed, spec.salt, key);
    },
  };
};
