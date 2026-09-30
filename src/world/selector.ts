import { boundsOf, covers, emptyBox, hypot, type MutableBox, ORIGIN } from '../math/index.ts';
import { IndexSorter, KeySorter } from './index-sorter.ts';
import type { PointIndex } from './point-index.ts';
import type { QueryOptions, Reaction } from './query.ts';
import { contactShare, type Selection, type SortKey } from './selection.ts';
import type { UnitTable } from './unit-table.ts';

/** A game's rule for how sides regard each other: `a` is the side a query is relative to, `b` a candidate's. */
export type ReactionRule = (a: number, b: number) => Reaction;

/** The default rule: one side is friendly, two sides are hostile. */
export const bySides: ReactionRule = (a, b) => (a === b ? 'friendly' : 'hostile');

/** A game's targeting rule: whether `by` may pick `unit` at all (stealth, phasing, a spawn intro, a downed unit). */
export type TargetRule<Unit> = (by: Unit, unit: Unit) => boolean;

/** What the rules make of a query's side, and how. */
export interface SelectorRules<Unit> {
  /** How sides regard each other. */
  readonly reaction: ReactionRule;

  /** Whether a unit may be picked by the one asking; every unit may when absent. */
  readonly canTarget: TargetRule<Unit> | undefined;
}

/** Orders two sort keys: less first, equal (infinities included) as ties, NaN after every number. */
const compareKeys = (x: number, y: number): number => {
  if (x < y) {
    return -1;
  }

  if (x > y) {
    return 1;
  }

  if (x === y) {
    return 0;
  }

  return Number(Number.isNaN(x)) - Number(Number.isNaN(y));
};

/**
 * Selects units for a memory world's queries: narrows by the point index, keeps the units that pass the
 * side, the exclusions, the filter and the exact test, orders them by their keys (lower id on ties) and caps them at
 * `limit`. Its scratch arrays are reused, so a query allocates nothing once warm; it is not re-entrant, so a world
 * keeps one per nesting level (a filter or `canTarget` that queries the world again takes the next).
 */
export class Selector<Unit> {
  /** The largest body radius in the world, which an edge-measured query or a sweep widens its box by. */
  maxRadius = 0;

  /** The farthest any unit moved this tick, which a relative sweep widens its box by. */
  maxMotion = 0;

  readonly #table: UnitTable<Unit>;
  readonly #index: PointIndex;
  readonly #reaction: ReactionRule | undefined;
  readonly #canTarget: TargetRule<Unit> | undefined;
  readonly #box: MutableBox = emptyBox();
  readonly #candidates: number[] = [];
  readonly #kept: number[] = [];
  readonly #contacts: number[] = [];
  readonly #order: number[] = [];
  readonly #sorter = new IndexSorter((a, b) => this.#compare(a, b));
  readonly #ids = new KeySorter();
  readonly #keys: number[] = [];
  readonly #single: SortKey<Unit>[] = ['id'];
  readonly #point = { x: 0, z: 0 };
  #keyCount = 0;
  #ofSide = Number.NaN;
  #contact = 0;
  #fromX = 0;
  #fromZ = 0;

  constructor(table: UnitTable<Unit>, index: PointIndex, rules: SelectorRules<Unit>) {
    this.#table = table;
    this.#index = index;
    this.#reaction = rules.reaction === bySides ? undefined : rules.reaction;
    this.#canTarget = rules.canTarget;
  }

  /** The slots the last `run` selected, in order, valid up to its count. */
  get selected(): readonly number[] {
    return this.#order;
  }

  /** The contact share of each selected slot of the last sweep, in order. */
  get contacts(): readonly number[] {
    return this.#contacts;
  }

  /** Keeps the units that pass a selection's tests, unordered; returns how many. */
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

  /** The side the query is relative to, or NaN when it keeps every side. */
  #sideOf(options: QueryOptions<Unit>): number {
    const side = options.side ?? 'all';

    if (side === 'all') {
      return Number.NaN;
    }

    if (options.ofSide !== undefined) {
      return options.ofSide;
    }

    if (options.of === undefined) {
      throw new RangeError(`A query for ${side} needs the unit they are relative to (of), or its side (ofSide).`);
    }

    return this.#table.side[this.#table.slotOf(options.of)] ?? 0;
  }

  /** Whether one candidate passes the side, the exclusions, the exact test and the filter. */
  #passes(selection: Selection<Unit>, slot: number, unit: Unit): boolean {
    const { options } = selection;

    return (
      this.#isOnSide(options, slot) &&
      options.exclude?.has(unit) !== true &&
      (this.#canTarget === undefined || options.of === undefined || this.#canTarget(options.of, unit)) &&
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

    const reaction = this.#reaction === undefined ? bySides(ofSide, side) : this.#reaction(ofSide, side);

    const keep = options.side ?? 'all';

    if (keep === 'foes') {
      return reaction === 'hostile';
    }

    if (keep === 'allies') {
      return reaction === 'friendly';
    }

    return keep === 'all' || reaction !== 'friendly';
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

  /** Reads every kept entry's keys into `#keys`, and numbers the entries in `#order`; returns the keys. */
  #readKeys(selection: Selection<Unit>, kept: number): readonly SortKey<Unit>[] {
    const keys = this.#keysOf(selection);

    for (let i = 0; i < kept; i++) {
      this.#order[i] = i;

      for (let k = 0; k < keys.length; k++) {
        this.#keys[i * keys.length + k] = this.#keyOf(keys[k] ?? 'id', i);
      }
    }

    return keys;
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
    const keys = this.#readKeys(selection, kept);

    // Ordered by entity id alone (every catch): the ids are whole numbers, sorted natively with no comparison.
    if (keys.length === 1 && keys[0] === 'id') {
      this.#ids.sort(this.#order, this.#keys, kept);
    } else {
      this.#sorter.sort(this.#order, kept);
    }

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

  /**
   * Compares two kept entries by their keys in turn, then by entity id: equal keys (infinities included) fall to the id,
   * and a NaN key sorts after every number, so the order never depends on where the index kept the units.
   */
  #compare(a: number, b: number): number {
    const count = this.#keyCount;

    for (let k = 0; k < count; k++) {
      const order = compareKeys(this.#keys[a * count + k] ?? 0, this.#keys[b * count + k] ?? 0);

      if (order !== 0) {
        return order;
      }
    }

    return (this.#table.id[this.#kept[a] ?? 0] ?? 0) - (this.#table.id[this.#kept[b] ?? 0] ?? 0);
  }
}
