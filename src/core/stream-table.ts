import { keyed } from './keyed-roll.ts';
import { checkSeed, type Random, type SavableStream, savableStream } from './random.ts';

/** How one named stream draws: a sequential stream (call order matters) or keyed rolls (only the key matters). */
export interface StreamSpec {
  /** `sequential` for a salted Mulberry32 stream, `keyed` for keyed rolls under the same salt. */
  readonly kind: 'sequential' | 'keyed';

  /** The salt mixed with the run's seed: one per name, so no two streams draw alike (nor two keyed names roll alike). */
  readonly salt: number;
}

/**
 * The host's stream table: every named stream a hook may ask for, resolved to a sequential stream of its own or to
 * keyed rolls. Keyed names draw only from their key, so adding or reordering rolls elsewhere shifts nothing. The
 * sequential streams' states can be saved and restored (a checkpoint, a replay, a rollback).
 */
export interface StreamTable<Name extends string> {
  /** The run's seed every stream is built from. */
  readonly seed: number;

  /**
   * The draw source for `name`. A sequential name returns its shared stream and ignores `key`. A keyed name returns a
   * fresh source whose draws are keyed rolls over `key` plus a draw index, and throws when `key` is missing.
   */
  readonly random: (name: Name, key?: readonly number[]) => Random;

  /** The state of every sequential stream, by name: what `restore` takes back. */
  readonly save: () => Readonly<Partial<Record<Name, number>>>;

  /** Puts the sequential streams back to saved states; a name it does not give keeps its state. */
  readonly restore: (saved: Readonly<Partial<Record<Name, number>>>) => void;
}

/** Builds the stream table for one run from its seed and the game's specs, one entry per name. */
export const createStreamTable = <const Specs extends Readonly<Record<string, StreamSpec>>>(
  seed: number,
  specs: Specs
): StreamTable<Extract<keyof Specs, string>> => {
  type Name = Extract<keyof Specs, string>;

  const sequential = new Map<string, SavableStream>();
  const salts = new Map<number, string>();

  checkSeed(seed, 'seed');

  for (const [name, spec] of Object.entries(specs)) {
    const taken = salts.get(checkSeed(spec.salt, 'salt'));

    if (taken !== undefined) {
      throw new RangeError(`Streams ${taken} and ${name} share the salt ${spec.salt}: give each its own.`);
    }

    salts.set(spec.salt, name);

    if (spec.kind === 'sequential') {
      sequential.set(name, savableStream(seed, spec.salt));
    }
  }

  return {
    seed,

    random: (name, key) => {
      const found = sequential.get(name);

      if (found !== undefined) {
        return found.random;
      }

      const spec = specs[name];

      if (spec === undefined || key === undefined) {
        throw new RangeError(`Stream ${name} is ${spec === undefined ? 'not in the table' : 'keyed and needs a key'}.`);
      }

      return keyed(seed, spec.salt, key);
    },

    save: () => {
      const saved: Partial<Record<Name, number>> = {};

      for (const [name, one] of sequential) {
        Reflect.set(saved, name, one.save());
      }

      return saved;
    },

    restore: (saved) => {
      for (const [name, one] of sequential) {
        const state: unknown = Reflect.get(saved, name);

        if (typeof state === 'number') {
          one.restore(state);
        }
      }
    }
  };
};
