/** Below this many entries an insertion sort beats the merge sort. */
const SHORT = 16;

/**
 * Sorts a prefix of a reused array of numbers in place by a comparison (§I.5.4): insertion for short lists, else a
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
