/**
 * The world (§I.6, §II.3.5): `WorldQuery`, the one read API a spell or an area trigger asks the world through (unit
 * queries with sides, orders and filters, sweeps, lines of sight, placement), and `createMemoryWorld`, a reference
 * implementation over a uniform grid (or a k-d tree) for moving units and an R-tree for static geometry.
 */

export {
  type CreateMemoryWorld,
  createMemoryWorld,
  type MemoryWorld,
  type MemoryWorldOptions,
  type QueryExtensions,
} from './memory-world.ts';

export type {
  BodyMove,
  ChainOptions,
  Cluster,
  DensestOptions,
  PointPick,
  QueryOptions,
  QueryOrder,
  QuerySide,
  RangeOptions,
  SweepOptions,
  UnitSet,
  WorldQuery,
} from './query.ts';

export type { StaticShape } from './statics.ts';
export type { UnitSpec } from './unit-table.ts';
