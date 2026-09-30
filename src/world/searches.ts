import type { Vec2 } from '../math/index.ts';
import type { Cluster, DensestOptions, SweepOptions } from './query.ts';
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
 * The densest cluster: the candidates within `range` of `from`, in the query's order (nearest first), up
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
