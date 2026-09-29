import { explainModifier } from '../modifiers/index.ts';
import type { AuraItem } from './active-aura.ts';
import type { ClockRescale } from './application.ts';
import type { AuraTypes } from './aura-types.ts';
import type { AuraTables } from './compile.ts';
import type { EventParts } from './events.ts';

/** An aura's own multiplier on a stat: the product of its `mul` modifiers on it at its stacks. */
const ownProduct = <G extends AuraTypes>(tables: AuraTables, item: AuraItem<G>, stat: number): number => {
  let product = 1;

  for (const modifier of tables.lists[item.id]?.modifiers ?? []) {
    if (modifier.stat === stat && modifier.op === 'mul') {
      product *= explainModifier(modifier, item.stacks).landed ?? 1;
    }
  }

  return product;
};

/** Whether a change of an aura changes its bearer's tags for the host (`onTagsChanged`): any but a refresh. */
export const isTagEdge = <G extends AuraTypes>(parts: EventParts<G>, code: number, id: number): boolean =>
  code !== 1 && parts.host.onTagsChanged !== undefined && parts.tables.tagBits[id]?.isEmpty() === false;

/** The clock rescale an aura declares on this edge (§II.6 A13), for the host; `undefined` when it declares none. */
export const rescaleOn = <G extends AuraTypes>(
  parts: EventParts<G>,
  code: number,
  item: AuraItem<G>,
): ClockRescale | undefined => {
  const { tables } = parts;
  const stat = tables.rescaleStat[item.id];
  const rescale = parts.registry.defs[item.id]?.rescale;

  if (stat === undefined || rescale === undefined || ((tables.rescaleOn[item.id] ?? 0) & (1 << code)) === 0) {
    return undefined;
  }

  const product = ownProduct(tables, item, stat);

  return {
    aura: item.id,
    stat,
    factor: code <= 1 ? 1 / product : product,
    isPendingOnly: rescale.clocks !== 'all',
    scope: rescale.scope ?? -1,
  };
};
