import type { Vec2 } from '../math/index.ts';
import type { SweepOptions } from './query.ts';
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
}

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
