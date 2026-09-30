/**
 * Units (§I.6 Units, §I.7.1 F13, §II.6 U1–U3): one unit shape for heroes, creatures and summons. Templates
 * (`defineUnits`) carry base stats, class tags, traits and an optional auto-attack; a unit system spawns units with
 * their stats snapshotted, moves them through their lifecycle, derives their states from their aura tags
 * (`defineUnitStates`), keeps their health, is the damage system's unit host, and summons units owned by others (F18).
 */

export {
  type HealthPolicy,
  type SpawnUnit,
  type UnitExtFactory,
  type UnitScripts,
  type UnitSystemBase,
  type UnitSystemOptions,
} from './engine.ts';

export { createUnitEvent, type UnitEvent, type UnitEvents } from './events.ts';

export type { AuraRule } from './hosts.ts';

export {
  despawn,
  type DespawnProc,
  despawnSummons,
  type DespawnSummonsProc,
  revive,
  type ReviveProc,
  summon,
  type SummonPlacement,
  type SummonProc,
  type UnitProcKinds,
  type UnitProcs,
} from './procs.ts';

export { defineUnitStates, type UnitBlock, type UnitStateDef, type UnitStateTable } from './states.ts';
export { createUnitSystem, type UnitSystem } from './system.ts';
export { defineUnitTags, type UnitTagDef, type UnitTagTable } from './tags.ts';
export { Unit, type UnitParts } from './unit.ts';

export {
  defineUnit,
  defineUnits,
  HOLDS_GROUND,
  IMMOVABLE,
  INERT,
  PULL_IMMUNE,
  type UnitDef,
  type UnitRegistry,
  type UnitRegistryOptions,
  type UnitTraits,
} from './unit-def.ts';

export { type Lifecycle, type UnitId, type UnitShape, type UnitTagId, type UnitTypes } from './unit-types.ts';
