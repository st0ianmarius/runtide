import type { WorldQuery } from '../world/index.ts';

/**
 * A read-only view of the interpolated world a client draws (§II.6 R3), for aim assist and cast cues only: it answers
 * where units appear to be, never what the simulation decides, so nothing predicted may read it.
 */
export type CosmeticWorld<Unit> = Pick<
  WorldQuery<Unit>,
  'positionOf' | 'velocityOf' | 'radiusOf' | 'sideOf' | 'idOf' | 'inside' | 'nearest' | 'lineClear'
>;
