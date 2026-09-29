/**
 * Area triggers (§I.6, §II.3.4): what a spell leaves in the world, with a position, a shape, a lifetime and hooks
 * (hazards, projectiles, cyclones, wells, domes, fields, sentries). A kind is plain data and standalone hooks
 * (`defineAreaTrigger`), registered by name (`defineAreaTriggers`) in the kind order they tick in.
 */

export {
  type AnyAreaTriggerDef,
  type AreaBound,
  type AreaCues,
  type AreaFn,
  type AreaLimit,
  type AreaTriggerContext,
  type AreaTriggerDef,
  defineAreaTrigger,
  type EndReason,
  type Lifetime,
  type Position,
} from './area-def.ts';

export type { AreaTriggerHost } from './area-host.ts';

export type {
  AreaAura,
  AreaCaster,
  AreaCatch,
  AreaContact,
  AreaHit,
  AreaLedger,
  AreaLedgerSpec,
  AreaPhase,
  AreaPulse,
} from './delivery-def.ts';

export type { AreaTagId, AreaTriggerId, AreaTriggerTypes } from './area-types.ts';

export {
  AREA_TRIGGER_HOOKS,
  type AreaTriggerColumn,
  type AreaTriggerHookName,
  type AreaTriggerHookTables,
  type AreaTriggerRegistry,
  type AreaTriggerRegistryOptions,
  defineAreaTriggers,
} from './define-area-triggers.ts';

export {
  type AreaTriggerEvent,
  areaTriggerEvent,
  type AreaTriggerEvents,
  createAreaTriggerEvent,
  END_REASONS,
} from './events.ts';

export { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
export { type AreaTriggerProcKinds, type AreaTriggerProcs, spawn, type SpawnProc } from './procs.ts';
export type { AreaInterception, AreaQueries, AreaQuery, CoverQuery } from './queries.ts';

export {
  AREA_FIELDS,
  type AreaField,
  type AreaReplica,
  type AreaReplication,
  type AreaReplicationSpec,
  type CompiledReplication,
} from './replication.ts';

export type { SpawnSpec } from './spawner.ts';
export { type AreaTriggerSystem, createAreaTriggerSystem } from './system.ts';
export type { AreaTriggerSystemBase, AreaTriggerSystemOptions } from './system-options.ts';
export { type AreaTagDef, type AreaTagTable, defineAreaTags } from './tags.ts';
