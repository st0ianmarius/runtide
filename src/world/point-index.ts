import KDBush from 'kdbush';

import type { Box } from '../math/index.ts';
import type { UnitTable } from './unit-table.ts';

/**
 * The point index a memory world narrows unit queries with: it answers which slots may stand in a box, and
 * the exact test comes after. Two kinds, behind the same queries: a uniform grid updated as units move, and a k-d tree
 * rebuilt when positions changed (for large, sparse worlds where one cell size does not fit).
 */
export interface PointIndex {
  /** A slot was added at its position. */
  readonly insert: (slot: number) => void;

  /** A slot moved to its new position. */
  readonly move: (slot: number) => void;

  /** A slot was removed. */
  readonly remove: (slot: number) => void;

  /** Writes every slot that may stand in `box` into `out` from index 0 and returns how many, in no fixed order. */
  readonly search: (box: Box, out: number[]) => number;
}

/** A column of slot links, grown by doubling. */
const grownInts = (values: Int32Array<ArrayBuffer>, size: number): Int32Array<ArrayBuffer> => {
  if (size <= values.length) {
    return values;
  }

  const grown = new Int32Array(Math.max(size, values.length * 2)).fill(-1);

  grown.set(values);

  return grown;
};

/**
 * A uniform grid over the world's bounds: a dense array of cells, each a doubly linked list of slots in typed arrays,
 * so a move between cells is O(1) and allocates nothing. A unit outside the bounds sits in the nearest edge cell.
 */
export class GridIndex<Unit> implements PointIndex {
  readonly #table: UnitTable<Unit>;
  readonly #bounds: Box;
  readonly #cell: number;
  readonly #cols: number;
  readonly #rows: number;
  readonly #head: Int32Array;
  #next = new Int32Array(64).fill(-1);
  #prev = new Int32Array(64).fill(-1);
  #cellOf = new Int32Array(64).fill(-1);

  constructor(table: UnitTable<Unit>, parts: { readonly bounds: Box; readonly cell: number }) {
    this.#table = table;
    this.#bounds = parts.bounds;
    this.#cell = parts.cell;
    this.#cols = Math.max(1, Math.ceil((parts.bounds.maxX - parts.bounds.minX) / parts.cell));
    this.#rows = Math.max(1, Math.ceil((parts.bounds.maxZ - parts.bounds.minZ) / parts.cell));
    this.#head = new Int32Array(this.#cols * this.#rows).fill(-1);
  }

  readonly insert = (slot: number): void => {
    this.#next = grownInts(this.#next, slot + 1);
    this.#prev = grownInts(this.#prev, slot + 1);
    this.#cellOf = grownInts(this.#cellOf, slot + 1);
    this.#link(slot, this.#cellAt(slot));
  };

  readonly move = (slot: number): void => {
    const cell = this.#cellAt(slot);

    if (cell !== this.#cellOf[slot]) {
      this.#unlink(slot);
      this.#link(slot, cell);
    }
  };

  readonly remove = (slot: number): void => {
    this.#unlink(slot);
    this.#cellOf[slot] = -1;
  };

  readonly search = (box: Box, out: number[]): number => {
    const c0 = this.#column(box.minX);
    const c1 = this.#column(box.maxX);
    const r0 = this.#row(box.minZ);
    const r1 = this.#row(box.maxZ);
    let count = 0;

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let slot = this.#head[row * this.#cols + col] ?? -1; slot >= 0; slot = this.#next[slot] ?? -1) {
          out[count] = slot;
          count += 1;
        }
      }
    }

    return count;
  };

  /** The column of an x, clamped to the grid. */
  #column(x: number): number {
    const col = Math.floor((x - this.#bounds.minX) / this.#cell);

    return Number.isNaN(col) ? 0 : Math.min(this.#cols - 1, Math.max(0, col));
  }

  /** The row of a z, clamped to the grid. */
  #row(z: number): number {
    const row = Math.floor((z - this.#bounds.minZ) / this.#cell);

    return Number.isNaN(row) ? 0 : Math.min(this.#rows - 1, Math.max(0, row));
  }

  /** The cell a slot's position falls in. */
  #cellAt(slot: number): number {
    return this.#row(this.#table.z[slot] ?? 0) * this.#cols + this.#column(this.#table.x[slot] ?? 0);
  }

  /** Puts a slot at the head of a cell's list. */
  #link(slot: number, cell: number): void {
    const head = this.#head[cell] ?? -1;

    this.#next[slot] = head;
    this.#prev[slot] = -1;

    if (head >= 0) {
      this.#prev[head] = slot;
    }

    this.#head[cell] = slot;
    this.#cellOf[slot] = cell;
  }

  /** Takes a slot out of its cell's list. */
  #unlink(slot: number): void {
    const cell = this.#cellOf[slot] ?? -1;
    const next = this.#next[slot] ?? -1;
    const prev = this.#prev[slot] ?? -1;

    if (cell < 0) {
      return;
    }

    if (prev >= 0) {
      this.#next[prev] = next;
    } else {
      this.#head[cell] = next;
    }

    if (next >= 0) {
      this.#prev[next] = prev;
    }
  }
}

/**
 * A static k-d tree of the units' positions (`kdbush`), rebuilt on the first search after any unit was added, moved
 * or removed: one build per tick in a world where every unit moves, with no cell size to tune.
 */
export class KdIndex<Unit> implements PointIndex {
  readonly #table: UnitTable<Unit>;
  #tree: KDBush | undefined = undefined;
  #slots = new Int32Array(64);
  #isDirty = true;

  constructor(table: UnitTable<Unit>) {
    this.#table = table;
  }

  readonly insert = (): void => {
    this.#isDirty = true;
  };

  readonly move = (): void => {
    this.#isDirty = true;
  };

  readonly remove = (): void => {
    this.#isDirty = true;
  };

  readonly search = (box: Box, out: number[]): number => {
    const tree = this.#build();

    if (tree === undefined) {
      return 0;
    }

    const found = tree.range(box.minX, box.minZ, box.maxX, box.maxZ);

    for (const [i, index] of found.entries()) {
      out[i] = this.#slots[index] ?? -1;
    }

    return found.length;
  };

  /** The tree over the live slots, rebuilt when anything changed; `undefined` for an empty world. */
  #build(): KDBush | undefined {
    if (!this.#isDirty) {
      return this.#tree;
    }

    const table = this.#table;

    this.#isDirty = false;
    this.#tree = undefined;

    if (table.size === 0) {
      return undefined;
    }

    const tree = new KDBush(table.size);

    this.#slots = grownInts(this.#slots, table.size);

    for (let slot = 0; slot < table.span; slot++) {
      if (table.units[slot] !== undefined) {
        this.#slots[tree.add(table.x[slot] ?? 0, table.z[slot] ?? 0)] = slot;
      }
    }

    tree.finish();
    this.#tree = tree;

    return tree;
  }
}
