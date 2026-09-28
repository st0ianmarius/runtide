import type { Vec2 } from '../math/index.ts';
import type { ChainOptions, Cluster, DensestOptions, SweepOptions } from './query.ts';
import type { Selection } from './selection.ts';
import type { Selector } from './selector.ts';
import type { UnitTable } from './unit-table.ts';

/** What the searches run over: a world's units, its selector and a reused selection. */
export interface SearchParts<Unit> {
  /** The units. */
  readonly table: UnitTable<Unit>;

  /** The selector. */
  readonly selector: Selector<Unit>;

  /** A selection to reuse. */
  readonly selection: Selection<Unit>;

  /** A scratch list of slots. */
  readonly slots: number[];
}

/** Writes the mean position of the gathered slots into a cluster, with its count. */
const centroid = <Unit>(parts: SearchParts<Unit>, count: number, out: Cluster<Unit>): void => {
  const { table, selector } = parts;
  let x = 0;
  let z = 0;

  for (let i = 0; i < count; i++) {
    const slot = selector.gathered[i] ?? -1;

    x += table.x[slot] ?? 0;
    z += table.z[slot] ?? 0;
  }

  out.count = count;
  out.x = x / count;
  out.z = z / count;
};

/**
 * The densest cluster (§II.6 W10): the candidates within `range` of `from`, in the query's order (nearest first), up
 * to `cap`, each scored by the units within `radius` of it that pass the same options; the first highest wins, and its
 * cluster's centroid is written with it. An empty cluster when nothing is in range.
 */
export const densest = <Unit>(
  parts: SearchParts<Unit>,
  [from, options]: readonly [Vec2, DensestOptions<Unit>],
  out: Cluster<Unit>,
): Cluster<Unit> => {
  const { table, selector, selection, slots } = parts;
  const found = Math.min(selector.run(selection.around(from, options)), options.cap ?? Number.POSITIVE_INFINITY);
  let best = 0;

  out.unit = undefined;
  out.count = 0;
  out.x = from.x;
  out.z = from.z;

  for (let i = 0; i < found; i++) {
    slots[i] = selector.selected[i] ?? -1;
  }

  for (let i = 0; i < found; i++) {
    const slot = slots[i] ?? -1;

    selection.around({ x: table.x[slot] ?? 0, z: table.z[slot] ?? 0 }, options).range = options.radius;

    const count = selector.gather(selection);

    if (count > best) {
      best = count;
      out.unit = table.units[slot];
      centroid(parts, count, out);
    }
  }

  return out;
};

/**
 * A chain (§II.6 W10): the first link is `first` when given (taken as it is), else the nearest unit within `range` of
 * `from`; each next link is the unit within `range` of the last link that comes first in the query's order (nearest
 * by default), never one already in the chain; it stops at `jumps` links or when no unit is left in range.
 */
export const chain = <Unit>(
  parts: SearchParts<Unit>,
  [from, options]: readonly [Vec2, ChainOptions<Unit>],
  out: (Unit | undefined)[],
): number => {
  const { table, selector, selection, slots } = parts;
  let count = 0;
  let at = from;

  if (options.first !== undefined && options.jumps > 0) {
    const slot = table.slotOf(options.first);

    slots[0] = slot;
    out[0] = options.first;
    count = 1;
    at = { x: table.x[slot] ?? 0, z: table.z[slot] ?? 0 };
  }

  while (count < options.jumps) {
    selection.around(at, options);

    for (let i = 0; i < count; i++) {
      selection.skip[i] = slots[i] ?? -1;
    }

    selection.skipCount = count;

    if (selector.run(selection) === 0) {
      break;
    }

    const slot = selector.selected[0] ?? -1;

    slots[count] = slot;
    out[count] = table.units[slot];
    count += 1;
    at = { x: table.x[slot] ?? 0, z: table.z[slot] ?? 0 };
  }

  return count;
};

/** The units a body sweeping a segment touches, in order of contact, with the shares written when asked. */
export const sweep = <Unit>(
  parts: SearchParts<Unit>,
  [segment, options]: readonly [readonly [Vec2, Vec2], SweepOptions<Unit>],
  out: (Unit | undefined)[],
): number => {
  const { table, selector, selection } = parts;
  const count = selector.run(selection.along(segment, options));
  const { shares } = options;

  for (let i = 0; i < count; i++) {
    out[i] = table.units[selector.selected[i] ?? -1];

    if (shares !== undefined) {
      shares[i] = selector.contacts[i] ?? 0;
    }
  }

  return count;
};

/**
 * Where a shot from `from` at `speed` meets a unit that keeps its velocity: the smallest positive time `t` with
 * `|p + v t − from| = speed × t`, or the unit's position now when there is none.
 */
export const leadPoint = ([position, velocity]: readonly [Vec2, Vec2], from: Vec2, speed: number): Vec2 => {
  const dx = position.x - from.x;
  const dz = position.z - from.z;
  const a = velocity.x * velocity.x + velocity.z * velocity.z - speed * speed;
  const b = 2 * (dx * velocity.x + dz * velocity.z);
  const c = dx * dx + dz * dz;
  let t = Number.NaN;

  if (Math.abs(a) < 1e-12) {
    t = b < 0 ? -c / b : Number.NaN;
  } else {
    const discriminant = b * b - 4 * a * c;

    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const t1 = (-b - root) / (2 * a);
      const t2 = (-b + root) / (2 * a);

      t = Math.min(t1 > 0 ? t1 : Number.POSITIVE_INFINITY, t2 > 0 ? t2 : Number.POSITIVE_INFINITY);
    }
  }

  return Number.isFinite(t) && t > 0 ? { x: position.x + velocity.x * t, z: position.z + velocity.z * t } : position;
};
