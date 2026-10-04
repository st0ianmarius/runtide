/**
 * The deterministic core: random streams and keyed rolls, the fixed-step clock with its countdowns, stamps and the
 * timing wheel, ordered registries with their dense tables, bitsets, pools, scratch lists, the event bus and the
 * state digest a game's snapshot checksum folds.
 */

export { type Bitset, createBitset } from './bitset.ts';
export { type Bus, type BusOptions, createBus, type EventKinds, type Listener } from './bus.ts';

export { type ClockOptions, createClock, type SimClock, type Stamp } from './clock.ts';

export { countDown, COUNTDOWN_EPSILON, isRunOut, stepsUntil } from './countdown.ts';

export type { Defined } from './defined.ts';
export { digest, DIGEST_START, digestOf, digestText } from './digest.ts';
export { createEntityIds, type EntityIds } from './entity-ids.ts';
export { int, pick, shuffle, weighted } from './draws.ts';
export type { EventKind, Handle, Id } from './ids.ts';
export { keyed, roll, rollKey } from './keyed-roll.ts';
export { createPool, NO_HANDLE, type Pool, POOL_MIN_FREE, type PoolOptions } from './pool.ts';
export { checkSeed, foldSeed, type Random, type SavableStream, savableStream, stream } from './random.ts';

export {
  checkOrder,
  createRegistry,
  type DefOf,
  type Registry,
  type RegistryOptions,
  TOMBSTONE,
  type Tombstone
} from './registry.ts';

export type { Column, ColumnSpec, ColumnType } from './registry-tables.ts';
export { createScratch, type Scratch } from './scratch.ts';
export { createStreamTable, type StreamSpec, type StreamTable } from './stream-table.ts';
export { defineTickSlots, type TickSlotDef, type TickSlotId } from './tick-slots.ts';
export { createTimingWheel, type TimingWheel, type TimingWheelOptions } from './timing-wheel.ts';
