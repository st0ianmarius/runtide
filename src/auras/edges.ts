import type { AuraTypes } from './aura-types.ts';
import type { EventParts } from './events.ts';

/** Whether a change of an aura changes its bearer's tags for the host (`onTagsChanged`): applied, expired, removed. */
export const isTagEdge = <G extends AuraTypes>(parts: EventParts<G>, code: number, id: number): boolean =>
  (code === 0 || code === 2 || code === 3) &&
  parts.host.onTagsChanged !== undefined &&
  parts.tables.tagBits[id]?.isEmpty() === false;
