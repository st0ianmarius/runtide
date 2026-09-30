import { boundsOf, covers, emptyBox, hypot, type MutableBox, ORIGIN } from '../math/index.ts';
import { IndexSorter } from './index-sorter.ts';
import type { PointIndex } from './point-index.ts';
import type { QueryOptions } from './query.ts';
import { contactShare, type Selection, type SortKey } from './selection.ts';
import type { UnitTable } from './unit-table.ts';

/** A game's rule for which sides are foes: `a` is the side a query is relative to, `b` a candidate's. */
export type FoeRule = (a: number, b: number) => boolean;

/** The default foe rule: different sides are foes. */
export const differentSides: FoeRule = (a, b) => a !== b;

/**
 * Selects units for a memory world's queries: narrows by the point index, keeps the units that pass the
 * side, the exclusions, the filter and the exact test, orders them by their keys (lower id on ties) and caps them at
 * `limit`. Its scratch arrays are reused, so a query allocates nothing once warm; it
 * is not re-entrant, so a filter or an order function must not query the same world.
 */
export class Selector<Unit> {
  /** The largest body radius in the world, which an edge-measured query or a sweep widens its box by. */
  maxRadius = 0;

  /** The farthest any unit moved this tick, which a relative sweep widens its box by. */
  maxMotion = 0;

  readonly #table: UnitTable<Unit>;
  readonly #index: PointIndex;
  readonly #isFoe: FoeRule | undefined;
  readonly #box: MutableBox = emptyBox();
  readonly #candidates: number[] = [];
  readonly #kept: number[] = [];
  readonly #contacts: number[] = [];
  readonly #order: number[] = [];
  readonly #sorter = new IndexSorter((a, b) => this.#compare(a, b));
  readonly #keys: number[] = [];
  readonly #single: SortKey<Unit>[] = ['id'];
  readonly #point = { x: 0, z: 0 };
  #keyCount = 0;
  #ofSide = Number.NaN;
  #contact = 0;
  #fromX = 0;
  #fromZ = 0;

  constructor(table: UnitTable<Unit>, index: PointIndex, isFoe: FoeRule) {
    this.#table = table;
    this.#index = index;
    this.#isFoe = isFoe === differentSides ? undefined : isFoe;
  }

  /** The slots the last `run` selected, in order, valid up to its count. */
  get selected(): readonly number[] {
    return this.#order;
  }

  /** The slots the last `gather` kept, in no fixed order, valid up to its count. */
  get gathered(): readonly number[] {
    return this.#kept;
  }

  /** The contact share of each selected slot of the last sweep, in order. */
  get contacts(): readonly number[] {
    return this.#contacts;
  }

  /** Keeps the units that pass a selection's tests, unordered; returns how many (read them from `gathered`). */
  gather(selection: Selection<Unit>): number {
    return this.#keep(selection, this.#index.search(this.#boxOf(selection), this.#candidates));
  }

  /** Runs a selection and returns how many slots it kept (read them from `selected`). */
  run(selection: Selection<Unit>): number {
    const kept = this.gather(selection);
    const { options } = selection;

    if (kept > 1 && options.limit === 1) {
      this.#first(selection, kept);

      return 1;
    }

    this.#sort(selection, kept);

    return Math.min(kept, options.limit ?? kept);
  }

  /** How many units a selection keeps: its gather alone, unless a limit needs them ordered. */
  count(selection: Selection<Unit>): number {
    return selection.options.limit === undefined ? this.gather(selection) : this.run(selection);
  }

  /** Runs a selection and writes its units into `out` from index 0; returns how many. */
  write(selection: Selection<Unit>, out: (Unit | undefined)[]): number {
    const count = this.run(selection);

    for (let i = 0; i < count; i++) {
      out[i] = this.#table.units[this.#order[i] ?? -1];
    }

    return count;
  }

  /** The distance from the selection's point to a slot's centre, or to its edge when measured so. */
  distance(selection: Selection<Unit>, slot: number): number {
    const table = this.#table;
    const d = hypot((table.x[slot] ?? 0) - selection.x, (table.z[slot] ?? 0) - selection.z);

    return selection.options.measure === 'edge' ? d - (table.radius[slot] ?? 0) : d;
  }

  /** The box the point index is searched in. */
  #boxOf(selection: Selection<Unit>): MutableBox {
    const box = this.#box;

    if (selection.shape !== undefined) {
      return boundsOf(selection.shape, selection.options.measure === 'edge' ? this.maxRadius : 0, box);
    }

    if (selection.isSweep) {
      const { segment } = selection;
      const reach = selection.reach + this.maxRadius + (selection.isRelative ? this.maxMotion : 0);

      box.minX = Math.min(segment.ax, segment.bx) - reach;
      box.minZ = Math.min(segment.az, segment.bz) - reach;
      box.maxX = Math.max(segment.ax, segment.bx) + reach;
      box.maxZ = Math.max(segment.az, segment.bz) + reach;

      return box;
    }

    const r = selection.range + (selection.options.measure === 'edge' ? this.maxRadius : 0);

    box.minX = selection.x - r;
    box.minZ = selection.z - r;
    box.maxX = selection.x + r;
    box.maxZ = selection.z + r;

    return box;
  }

  /** Keeps the candidates that pass every test, into `#kept`; returns how many. */
  #keep(selection: Selection<Unit>, found: number): number {
    const table = this.#table;
    let kept = 0;

    this.#ofSide = this.#sideOf(selection.options);

    for (let i = 0; i < found; i++) {
      const slot = this.#candidates[i] ?? -1;
      const unit = table.units[slot];

      if (unit !== undefined && this.#passes(selection, slot, unit)) {
        this.#kept[kept] = slot;
        this.#contacts[kept] = this.#contact;
        kept += 1;
      }
    }

    return kept;
  }

  /** The side of the unit the query asks for, or NaN when it keeps every side. */
  #sideOf(options: QueryOptions<Unit>): number {
    const side = options.side ?? 'all';

    if (side === 'all') {
      return Number.NaN;
    }

    if (options.of === undefined) {
      throw new RangeError(`A query for ${side} needs the unit they are relative to (of).`);
    }

    return this.#table.side[this.#table.slotOf(options.of)] ?? 0;
  }

  /** Whether one candidate passes the side, the exclusions, the exact test and the filter. */
  #passes(selection: Selection<Unit>, slot: number, unit: Unit): boolean {
    const { options } = selection;

    return (
      this.#isOnSide(options, slot) &&
      options.exclude?.has(unit) !== true &&
      this.#isCaught(selection, slot) &&
      (options.filter?.(unit) ?? true)
    );
  }

  /** Whether a slot is on the side the query keeps. */
  #isOnSide(options: QueryOptions<Unit>, slot: number): boolean {
    const ofSide = this.#ofSide;

    if (Number.isNaN(ofSide)) {
      return true;
    }

    const side = this.#table.side[slot] ?? 0;
    const isFoe = this.#isFoe === undefined ? side !== ofSide : this.#isFoe(ofSide, side);

    return (options.side === 'foes') === isFoe;
  }

  /** Whether a slot passes the selection's exact test: its shape, its range, or its sweep (noting the contact). */
  #isCaught(selection: Selection<Unit>, slot: number): boolean {
    const table = this.#table;

    if (selection.isSweep) {
      const share = contactShare(selection, table, slot);

      this.#contact = share ?? 0;

      return share !== undefined;
    }

    if (selection.shape === undefined) {
      return !selection.hasPoint || this.#isInRange(selection, slot);
    }

    const point = this.#point;

    point.x = table.x[slot] ?? 0;
    point.z = table.z[slot] ?? 0;

    return covers(selection.shape, point, selection.options.measure === 'edge' ? (table.radius[slot] ?? 0) : 0);
  }

  /** Whether a slot is within the selection's range. */
  #isInRange(selection: Selection<Unit>, slot: number): boolean {
    const d = this.distance(selection, slot);

    return selection.options.inclusive === true ? d <= selection.range : d < selection.range;
  }

  /** Reads every kept entry's keys into `#keys`, and numbers the entries in `#order`. */
  #readKeys(selection: Selection<Unit>, kept: number): void {
    const keys = this.#keysOf(selection);

    for (let i = 0; i < kept; i++) {
      this.#order[i] = i;

      for (let k = 0; k < keys.length; k++) {
        this.#keys[i * keys.length + k] = this.#keyOf(keys[k] ?? 'id', i);
      }
    }
  }

  /** Puts the first kept entry by the selection's keys first (a limit of 1): one scan, where a sort would order all. */
  #first(selection: Selection<Unit>, kept: number): void {
    let best = 0;

    this.#readKeys(selection, kept);

    for (let i = 1; i < kept; i++) {
      best = this.#compare(i, best) < 0 ? i : best;
    }

    this.#order[0] = this.#kept[best] ?? -1;
    this.#contacts[0] = this.#contacts[best] ?? 0;
  }

  /** Orders the kept entries into `#order` (their slots) and `#contacts` by the selection's keys. */
  #sort(selection: Selection<Unit>, kept: number): void {
    this.#readKeys(selection, kept);
    this.#sorter.sort(this.#order, kept);

    // The keys are spent: the contacts are reordered through them, then the entries become their slots.
    for (let i = 0; i < kept; i++) {
      const entry = this.#order[i] ?? 0;

      this.#keys[i] = this.#contacts[entry] ?? 0;
      this.#order[i] = this.#kept[entry] ?? -1;
    }

    for (let i = 0; i < kept; i++) {
      this.#contacts[i] = this.#keys[i] ?? 0;
    }
  }

  /** The keys a selection orders by, noting their count and the point `near` and `far` measure from. */
  #keysOf(selection: Selection<Unit>): readonly SortKey<Unit>[] {
    const { options } = selection;
    const order = options.order ?? selection.order;
    const from = selection.hasPoint ? selection : (options.from ?? ORIGIN);
    let keys: readonly SortKey<Unit>[] = this.#single;

    if (typeof order === 'object') {
      keys = order;
    } else {
      this.#single[0] = order;
    }

    this.#keyCount = keys.length;
    this.#fromX = from.x;
    this.#fromZ = from.z;

    return keys;
  }

  /** One key of the `i`-th kept entry. */
  #keyOf(key: SortKey<Unit>, i: number): number {
    const table = this.#table;
    const slot = this.#kept[i] ?? -1;

    if (typeof key === 'function') {
      const unit = table.units[slot];

      return unit === undefined ? 0 : key(unit);
    }

    if (key === 'id') {
      return table.id[slot] ?? 0;
    }

    if (key === 'contact') {
      return this.#contacts[i] ?? 0;
    }

    const d = hypot((table.x[slot] ?? 0) - this.#fromX, (table.z[slot] ?? 0) - this.#fromZ);

    return key === 'near' ? d : -d;
  }

  /** Compares two kept entries by their keys in turn, then by entity id. */
  #compare(a: number, b: number): number {
    const count = this.#keyCount;

    for (let k = 0; k < count; k++) {
      const difference = (this.#keys[a * count + k] ?? 0) - (this.#keys[b * count + k] ?? 0);

      if (difference !== 0) {
        return difference;
      }
    }

    return (this.#table.id[this.#kept[a] ?? 0] ?? 0) - (this.#table.id[this.#kept[b] ?? 0] ?? 0);
  }
}
