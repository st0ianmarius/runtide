import { TypedFastBitSet } from 'typedfastbitset';

/**
 * A set of small non-negative integers (dense ids) on 32-bit words: tag sets, `has`-hook tables, per-cast hit sets.
 * The in-place operations change this set; none allocates once the words are large enough.
 */
export interface Bitset {
  /** Whether `index` is in the set. Throws a `RangeError`, as `add` does, for an index that is not whole from 0. */
  has(index: number): boolean;

  /** Adds `index`, growing the words when needed. Throws a `RangeError` for an index that is not whole from 0. */
  add(index: number): void;

  /** Removes `index`. Throws a `RangeError`, as `add` does, for an index that is not whole from 0. */
  remove(index: number): void;

  /** Removes every index. */
  clear(): void;

  /** Whether the set is empty. */
  isEmpty(): boolean;

  /** The number of indexes in the set. */
  size(): number;

  /** Whether this set and `other` share an index. */
  intersects(other: Bitset): boolean;

  /** Adds every index of `other` to this set. */
  union(other: Bitset): void;

  /** Removes every index of `other` from this set. */
  difference(other: Bitset): void;

  /** Keeps only the indexes this set shares with `other`. */
  intersection(other: Bitset): void;

  /** Whether both sets hold the same indexes. */
  equals(other: Bitset): boolean;

  /** A new set with the same indexes. */
  clone(): Bitset;

  /** The indexes in ascending order, as a new array. */
  toArray(): number[];
}

/**
 * Throws unless `index` is a whole number from 0: the library reads a fraction's word and bit apart (1.5 tests as 1)
 * and a negative index's word as missing.
 */
const checkIndex = (index: number): number => {
  if (!(Number.isInteger(index) && index >= 0)) {
    throw new RangeError(`A bitset holds whole indices from 0; got ${index}.`);
  }

  return index;
};

/** The one implementation: a thin class over the library set, whose private field never leaks out. */
class WordBitset implements Bitset {
  readonly #set: TypedFastBitSet;

  constructor(set: TypedFastBitSet) {
    this.#set = set;
  }

  has(index: number): boolean {
    return this.#set.has(checkIndex(index));
  }

  add(index: number): void {
    this.#set.add(checkIndex(index));
  }

  remove(index: number): void {
    this.#set.remove(checkIndex(index));
  }

  clear(): void {
    // Zeroes the words in place: the library's own `clear` allocates a new word array on every call.
    this.#set.words.fill(0);
  }

  isEmpty(): boolean {
    return this.#set.isEmpty();
  }

  size(): number {
    return this.#set.size();
  }

  intersects(other: Bitset): boolean {
    return this.#set.intersects(WordBitset.#of(other));
  }

  union(other: Bitset): void {
    this.#set.union(WordBitset.#of(other));
  }

  difference(other: Bitset): void {
    this.#set.difference(WordBitset.#of(other));
  }

  intersection(other: Bitset): void {
    this.#set.intersection(WordBitset.#of(other));
  }

  equals(other: Bitset): boolean {
    return this.#set.equals(WordBitset.#of(other));
  }

  clone(): Bitset {
    return new WordBitset(this.#set.clone());
  }

  toArray(): number[] {
    return this.#set.array();
  }

  /** The library set behind a bitset made here; any other implementation is refused. */
  static #of(other: Bitset): TypedFastBitSet {
    if (!(other instanceof WordBitset)) {
      throw new TypeError('Only bitsets made by createBitset combine.');
    }

    return other.#set;
  }
}

/**
 * Creates a bitset holding `indexes` (none by default), each whole from 0 or it throws. Backed by `typedfastbitset`,
 * which never leaks out.
 */
export const createBitset = (indexes: Iterable<number> = []): Bitset => {
  const set = new WordBitset(new TypedFastBitSet());

  for (const index of indexes) {
    set.add(index);
  }

  return set;
};
