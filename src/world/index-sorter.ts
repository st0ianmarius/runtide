/** Below this many entries an insertion sort beats the merge sort. */
const SHORT = 16;

/**
 * Sorts a prefix of a reused array of numbers in place by a comparison: insertion for short lists, else a
 * bottom-up merge sort through a spare array it keeps. Stable, and allocation-free once its spare array has grown.
 */
export class IndexSorter {
  readonly #compare: (a: number, b: number) => number;
  readonly #spare: number[] = [];

  /** The run a merge reads from and the array it writes to, set per pass (fields, so a merge takes no tuple). */
  #from: number[] = [];
  #to: number[] = [];

  constructor(compare: (a: number, b: number) => number) {
    this.#compare = compare;
  }

  /** Sorts the first `count` entries of `entries`. */
  sort(entries: number[], count: number): void {
    if (count <= SHORT) {
      this.#insertion(entries, count);

      return;
    }

    this.#from = entries;
    this.#to = this.#spare;

    for (let width = 1; width < count; width *= 2) {
      for (let lo = 0; lo < count; lo += width * 2) {
        this.#merge(lo, Math.min(lo + width, count), Math.min(lo + width * 2, count));
      }

      const merged = this.#to;

      this.#to = this.#from;
      this.#from = merged;
    }

    const from = this.#from;

    for (let i = 0; from !== entries && i < count; i++) {
      entries[i] = from[i] ?? 0;
    }

    this.#from = this.#spare;
    this.#to = this.#spare;
  }

  /** Sorts the first `count` entries by insertion. */
  #insertion(entries: number[], count: number): void {
    for (let i = 1; i < count; i++) {
      const entry = entries[i] ?? 0;
      let j = i - 1;

      while (j >= 0 && this.#compare(entries[j] ?? 0, entry) > 0) {
        entries[j + 1] = entries[j] ?? 0;
        j -= 1;
      }

      entries[j + 1] = entry;
    }
  }

  /** Merges the runs `[lo, mid)` and `[mid, hi)` of the pass's `from` into its `to`. */
  #merge(lo: number, mid: number, hi: number): void {
    const from = this.#from;
    const to = this.#to;
    let i = lo;
    let j = mid;

    for (let k = lo; k < hi; k++) {
      const a = from[i] ?? 0;
      const b = from[j] ?? 0;

      if (j >= hi || (i < mid && this.#compare(a, b) <= 0)) {
        to[k] = a;
        i += 1;
      } else {
        to[k] = b;
        j += 1;
      }
    }
  }
}

/**
 * Sorts entries by one whole-number key each (an entity id), then by entry: a byte-wise radix sort over the keys,
 * which calls no comparison, skipping each byte every key shares (ids below 2¹⁶ sort in two passes). Short lists sort
 * by insertion. Its arrays grow to the longest list sorted and are reused, so a sort allocates nothing once warm.
 */
export class KeySorter {
  readonly #counts = new Int32Array(256);
  #keys = new Uint32Array(0);
  #spareKeys = new Uint32Array(0);
  #entries = new Int32Array(0);
  #spareEntries = new Int32Array(0);

  /** Orders `entries[0..count)` (entry indices) by `keys[entry]`, then by entry. */
  sort(entries: number[], keys: readonly number[], count: number): void {
    if (count <= SHORT) {
      insertionByKey(entries, keys, count);

      return;
    }

    this.#fill(entries, keys, count);

    for (let shift = 0; shift < 32; shift += 8) {
      this.#pass(shift, count);
    }

    for (let i = 0; i < count; i++) {
      entries[i] = this.#entries[i] ?? 0;
    }
  }

  /** Copies the entries and their keys (whole numbers from 0 below 2³²) into the typed arrays, grown when short. */
  #fill(entries: readonly number[], keys: readonly number[], count: number): void {
    if (this.#keys.length < count) {
      const size = 2 ** Math.ceil(Math.log2(count));

      this.#keys = new Uint32Array(size);
      this.#spareKeys = new Uint32Array(size);
      this.#entries = new Int32Array(size);
      this.#spareEntries = new Int32Array(size);
    }

    for (let i = 0; i < count; i++) {
      const entry = entries[i] ?? 0;
      this.#keys[i] = keys[entry] ?? 0;
      this.#entries[i] = entry;
    }
  }

  /** One stable counting pass on the byte at `shift`, skipped when every key has the same byte there. */
  #pass(shift: number, count: number): void {
    const counts = this.#counts;
    const keys = this.#keys;

    counts.fill(0);

    for (let i = 0; i < count; i++) {
      const digit = ((keys[i] ?? 0) >>> shift) & 255;

      counts[digit] = (counts[digit] ?? 0) + 1;
    }

    if (counts[((keys[0] ?? 0) >>> shift) & 255] === count) {
      return;
    }

    let sum = 0;

    for (let digit = 0; digit < 256; digit++) {
      const here = counts[digit] ?? 0;

      counts[digit] = sum;
      sum += here;
    }

    this.#scatter(shift, count);
  }

  /** Moves every key and entry to its place for the byte at `shift`, then swaps the arrays. */
  #scatter(shift: number, count: number): void {
    const counts = this.#counts;
    const keys = this.#keys;
    const entries = this.#entries;
    const toKeys = this.#spareKeys;
    const toEntries = this.#spareEntries;

    for (let i = 0; i < count; i++) {
      const key = keys[i] ?? 0;
      const digit = (key >>> shift) & 255;
      const at = counts[digit] ?? 0;

      toKeys[at] = key;
      toEntries[at] = entries[i] ?? 0;
      counts[digit] = at + 1;
    }

    this.#keys = toKeys;
    this.#spareKeys = keys;
    this.#entries = toEntries;
    this.#spareEntries = entries;
  }
}

/** Orders a short list of entries by their keys, then by entry, by insertion. */
const insertionByKey = (entries: number[], keys: readonly number[], count: number): void => {
  for (let i = 1; i < count; i++) {
    const entry = entries[i] ?? 0;
    const key = keys[entry] ?? 0;
    let j = i - 1;

    for (; j >= 0; j--) {
      const before = entries[j] ?? 0;
      const beforeKey = keys[before] ?? 0;

      if (beforeKey < key || (beforeKey === key && before < entry)) {
        break;
      }

      entries[j + 1] = before;
    }

    entries[j + 1] = entry;
  }
};
