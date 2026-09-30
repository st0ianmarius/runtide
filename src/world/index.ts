/**
 * The world: `WorldQuery`, the one read API a spell or an area trigger asks the world through (unit
 * queries with sides, orders and filters, sweeps, lines of sight, placement), and `createMemoryWorld`, a reference
 * implementation over a uniform grid (or a k-d tree) for moving units and an R-tree for static geometry.
 */

export {
  type CreateMemoryWorld,
  createMemoryWorld,
  type MemoryWorld,
  type MemoryWorldOptions,
  type QueryExtensions
} from './memory-world.ts';

export type {
  BodyMove,
  PointPick,
  QueryOptions,
  QueryOrder,
  QuerySide,
  RangeOptions,
  Reaction,
  SweepOptions,
  UnitSet,
  WorldQuery
} from './query.ts';

export type { ReactionRule, TargetRule } from './selector.ts';
export type { StaticShape } from './statics.ts';
export { Trail } from './trail.ts';
export type { UnitSpec, WorldSlots } from './unit-table.ts';
