import { boundsOf, covers, emptyBox, hypot, type MutableVec2, ORIGIN, type Shape, sweepCircle } from '../math/index.ts';
import { IndexSorter } from './index-sorter.ts';
import type { QueryOptions, QuerySide, UnitSet, WorldQuery } from './query.ts';
import type { Selection, SortKey } from './selection.ts';
import { compareKeys } from './selector.ts';
import type { Trail } from './trail.ts';

/** What a rewound view reads each unit's past from, and how far back. */
export interface RewindOptions<Unit> {
  /**
   * A unit's trail of replicated positions (`Trail`), or `undefined` for a unit with none, which is read where it
   * stands now.
   */
  readonly trailOf: (unit: Unit) => Trail | undefined;

  /** The tick to read the trails at, fractional for a client's interpolated view: the tick the client drew. */
  readonly tick: number;

  /**
   * How far a unit may stand now from where its trail puts it at `tick` (and at `tick − 1` for a relative sweep), a
   * finite number from 0: each search widens its reach by it against the live world, then tests its candidates at
   * their trail positions. Too small misses a unit that moved farther; larger only gathers more candidates.
   */
  readonly slack: number;
}

/**
 * The options a rewound search gathers its candidates with from the live world, reused: the caller's side and
 * targeting, its exclusions and filter folded into one filter, in the world's own order, uncapped. A unit asking
 * (`of`) and a side alone (`ofSide`) take their own subclasses, so each object carries exactly the fields it sets.
 */
class Candidates<Unit> {
  side: QuerySide = 'all';
  measure: 'centre' | 'edge' = 'centre';
  readonly inclusive = true;
  range = 0;
  radius = 0;
  readonly order = 'none';
  skip: UnitSet<Unit> | undefined = undefined;
  test: ((unit: Unit) => boolean) | undefined = undefined;

  /** The caller's exclusions and filter. */
  readonly filter = (unit: Unit): boolean => this.skip?.has(unit) !== true && (this.test?.(unit) ?? true);
}

/** Candidate options relative to a side alone. */
class SideCandidates<Unit> extends Candidates<Unit> {
  ofSide = 0;
}

/** Candidate options with a unit asking. */
class UnitCandidates<Unit> extends SideCandidates<Unit> {
  of: Unit;

  constructor(of: Unit) {
    super();
    this.of = of;
  }
}

/**
 * One nesting level of a rewound view's searches (a filter may search the view again): gathers candidates from the
 * live world with the reach widened by the slack, keeps those its selection catches at their rewound positions, and
 * orders them as the world would (lower entity id on ties). Its scratch arrays are reused, so a search allocates
 * nothing once warm.
 */
export class RewindLevel<Unit> {
  /** The live candidates of the last search. */
  readonly found: (Unit | undefined)[] = [];

  readonly #world: WorldQuery<Unit>;
  readonly #rewind: RewindOptions<Unit>;
  readonly #plain = new Candidates<Unit>();
  readonly #bySide = new SideCandidates<Unit>();
  #byUnit: UnitCandidates<Unit> | undefined = undefined;
  readonly #kept: (Unit | undefined)[] = [];
  readonly #xs: number[] = [];
  readonly #zs: number[] = [];
  readonly #ids: number[] = [];
  readonly #contacts: number[] = [];
  readonly #keys: number[] = [];
  readonly #order: number[] = [];
  readonly #sorter = new IndexSorter((a, b) => this.#compare(a, b));
  readonly #single: SortKey<Unit>[] = ['id'];
  readonly #bounds = emptyBox();
  readonly #corners: MutableVec2[] = [0, 1, 2, 3].map(() => ({ x: 0, z: 0 }));
  readonly #box: Shape = { kind: 'polygon', points: this.#corners, band: 0 };
  readonly #a = { x: 0, z: 0 };
  readonly #b = { x: 0, z: 0 };
  readonly #point = { x: 0, z: 0 };
  readonly #then = { x: 0, z: 0 };
  readonly #target = { at: { x: 0, z: 0 }, r: 0 };
  #contact = 0;
  #keyCount = 0;
  #fromX = 0;
  #fromZ = 0;
  #isEdge = false;

  constructor(world: WorldQuery<Unit>, rewind: RewindOptions<Unit>) {
    this.#world = world;
    this.#rewind = rewind;
  }

  /** Where a unit stood at the rewind's tick, into `out`: on its trail, or where it stands now without one. */
  positionOf(unit: Unit, out: MutableVec2): MutableVec2 {
    return this.#rewoundAt(unit, this.#rewind.tick, out);
  }

  /** Runs a selection set up by the caller and returns how many units it caught (`write` puts them out). */
  run(selection: Selection<Unit>): number {
    const { limit } = selection.options;
    const { slack } = this.#rewind;

    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 0)) {
      throw new RangeError(`A query's limit is a whole number from 0; got ${limit}.`);
    }

    if (!(Number.isFinite(slack) && slack >= 0)) {
      throw new RangeError(`A rewind's slack is a finite number from 0; got ${slack}.`);
    }

    const kept = this.#keep(selection, this.#gather(selection, slack));

    if ((selection.options.order ?? selection.order) === 'none') {
      for (let i = 0; i < kept; i++) {
        this.#order[i] = i;
      }
    } else {
      this.#sort(selection, kept);
    }

    return Math.min(kept, limit ?? kept);
  }

  /** Writes the first `count` units the last `run` caught into `out` from index 0, and their contacts into `shares`. */
  write(count: number, out: (Unit | undefined)[], shares?: number[]): number {
    for (let i = 0; i < count; i++) {
      const entry = this.#order[i] ?? -1;

      out[i] = this.#kept[entry];

      if (shares !== undefined) {
        shares[i] = this.#contacts[entry] ?? 0;
      }
    }

    return count;
  }

  /** The live options a search's candidates are gathered with, from the caller's. */
  #candidates(options: QueryOptions<Unit>): Candidates<Unit> {
    const side = options.side ?? 'all';
    let made: Candidates<Unit> = this.#plain;

    if (options.of !== undefined) {
      const byUnit = (this.#byUnit ??= new UnitCandidates<Unit>(options.of));

      byUnit.of = options.of;
      byUnit.ofSide = options.ofSide ?? (side === 'all' ? 0 : this.#world.sideOf(options.of));
      made = byUnit;
    } else if (options.ofSide !== undefined) {
      this.#bySide.ofSide = options.ofSide;
      made = this.#bySide;
    }

    made.side = side;
    made.measure = options.measure ?? 'centre';
    made.skip = options.exclude;
    made.test = options.filter;

    return made;
  }

  /** Gathers the live candidates into `found`, the selection's reach widened by `slack`; returns how many. */
  #gather(selection: Selection<Unit>, slack: number): number {
    const options = this.#candidates(selection.options);
    const world = this.#world;

    if (selection.isSweep) {
      const { segment } = selection;

      this.#a.x = segment.ax;
      this.#a.z = segment.az;
      this.#b.x = segment.bx;
      this.#b.z = segment.bz;
      options.radius = selection.reach + slack;

      return world.sweep(this.#a, this.#b, options, this.found);
    }

    if (selection.hasPoint) {
      this.#a.x = selection.x;
      this.#a.z = selection.z;
      options.range = selection.range + slack;

      return world.nearest(this.#a, options, this.found);
    }

    const box = selection.shape === undefined ? undefined : this.#boxAround(selection.shape, slack);

    return box === undefined ? world.all(options, this.found) : world.inside(box, options, this.found);
  }

  /**
   * The box around a shape, grown by `slack`, as a polygon whose edges count: a unit the shape catches at its rewound
   * position stands in it now. `undefined` for a shape with no finite box (an `outside`), searched world-wide.
   */
  #boxAround(shape: Shape, slack: number): Shape | undefined {
    const { minX, minZ, maxX, maxZ } = boundsOf(shape, 0, this.#bounds);

    if (!(Number.isFinite(minX) && Number.isFinite(minZ) && Number.isFinite(maxX) && Number.isFinite(maxZ))) {
      return undefined;
    }

    for (let i = 0; i < 4; i++) {
      const corner = this.#corners[i] ?? this.#a;

      corner.x = i === 0 || i === 3 ? minX - slack : maxX + slack;
      corner.z = i < 2 ? minZ - slack : maxZ + slack;
    }

    return this.#box;
  }

  /** Keeps the candidates the selection catches at their rewound positions, noting each one's; returns how many. */
  #keep(selection: Selection<Unit>, found: number): number {
    let kept = 0;

    for (let i = 0; i < found; i++) {
      const unit = this.found[i];

      if (unit !== undefined && this.#isCaught(selection, unit, this.positionOf(unit, this.#point))) {
        this.#kept[kept] = unit;
        this.#xs[kept] = this.#point.x;
        this.#zs[kept] = this.#point.z;
        this.#ids[kept] = this.#world.idOf(unit);
        this.#contacts[kept] = this.#contact;
        kept += 1;
      }
    }

    return kept;
  }

  /** Whether a selection catches a unit standing at `at`: its shape, its range, or its sweep (noting the contact). */
  #isCaught(selection: Selection<Unit>, unit: Unit, at: MutableVec2): boolean {
    if (selection.isSweep) {
      const share = this.#contactShare(selection, unit, at);

      this.#contact = share ?? 0;

      return share !== undefined;
    }

    const edge = selection.options.measure === 'edge' ? this.#world.radiusOf(unit) : 0;

    if (selection.shape !== undefined) {
      return covers(selection.shape, at, edge);
    }

    if (!selection.hasPoint) {
      return true;
    }

    const d = hypot(at.x - selection.x, at.z - selection.z) - edge;

    return selection.options.inclusive === true ? d <= selection.range : d < selection.range;
  }

  /**
   * The share along a sweep at which its body first touches a unit standing at `at`, or `undefined`. A relative sweep
   * runs against the unit's rewound motion: from its trail at `tick − 1` to `tick`, over the shares the sweep spans.
   */
  #contactShare(selection: Selection<Unit>, unit: Unit, at: MutableVec2): number | undefined {
    const { segment } = selection;
    const target = this.#target;
    const start = this.#a;
    const end = this.#b;

    target.r = selection.reach + this.#world.radiusOf(unit);
    target.at.x = at.x;
    target.at.z = at.z;
    start.x = segment.ax;
    start.z = segment.az;
    end.x = segment.bx;
    end.z = segment.bz;

    if (selection.isRelative) {
      const tick = this.#rewind.tick - 1;
      const then = this.#then;

      this.#rewoundAt(unit, tick + selection.since, then);
      start.x -= then.x;
      start.z -= then.z;
      this.#rewoundAt(unit, tick + selection.until, then);
      end.x -= then.x;
      end.z -= then.z;
      target.at.x = 0;
      target.at.z = 0;
    }

    const share = sweepCircle(start, end, target);

    return share === 0 && selection.isOpen ? undefined : share;
  }

  /**
   * Where a unit stood at a (fractional) tick, into `out`: on its trail; without one, where it stands now, or for a
   * tick before the rewind's (a relative sweep's start) on the line from where it stood at the start of this tick.
   */
  #rewoundAt(unit: Unit, tick: number, out: MutableVec2): MutableVec2 {
    const trail = this.#rewind.trailOf(unit);

    if (trail?.at(tick, out) !== undefined) {
      return out;
    }

    const world = this.#world;
    const share = 1 - Math.min(1, Math.max(0, this.#rewind.tick - tick));
    const before = world.previousOf(unit, out);
    const x = before.x;
    const z = before.z;
    const now = world.positionOf(unit, out);

    out.x = x + (now.x - x) * share;
    out.z = z + (now.z - z) * share;

    return out;
  }

  /** Orders the kept entries into `#order` by the selection's keys, then entity id. */
  #sort(selection: Selection<Unit>, kept: number): void {
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
    this.#isEdge = options.measure === 'edge';

    for (let i = 0; i < kept; i++) {
      this.#order[i] = i;

      for (let k = 0; k < keys.length; k++) {
        this.#keys[i * keys.length + k] = this.#keyOf(keys[k] ?? 'id', i);
      }
    }

    this.#sorter.sort(this.#order, kept);
  }

  /** One key of the `i`-th kept entry. */
  #keyOf(key: SortKey<Unit>, i: number): number {
    const unit = this.#kept[i];

    if (typeof key === 'function') {
      return unit === undefined ? 0 : key(unit);
    }

    switch (key) {
      case 'id':
        return this.#ids[i] ?? 0;
      case 'contact':
        return this.#contacts[i] ?? 0;
      case 'near':
        return this.#reach(i);
      case 'far':
        return -this.#reach(i);
      // `none` among other keys orders nothing.
      case 'none':
        return 0;
    }
  }

  /** How far the `i`-th kept entry stood from the point `near` and `far` measure from: to its centre, or its edge. */
  #reach(i: number): number {
    const unit = this.#kept[i];
    const centre = hypot((this.#xs[i] ?? 0) - this.#fromX, (this.#zs[i] ?? 0) - this.#fromZ);

    return this.#isEdge && unit !== undefined ? centre - this.#world.radiusOf(unit) : centre;
  }

  /** Compares two kept entries by their keys in turn, then by entity id. */
  #compare(a: number, b: number): number {
    const count = this.#keyCount;

    for (let k = 0; k < count; k++) {
      const order = compareKeys(this.#keys[a * count + k] ?? 0, this.#keys[b * count + k] ?? 0);

      if (order !== 0) {
        return order;
      }
    }

    return (this.#ids[a] ?? 0) - (this.#ids[b] ?? 0);
  }
}
