/**
 * Units (§I.6 Units, §I.7.1 F13, §II.6 U1–U3): one unit shape for heroes, creatures and summons. Templates
 * (`defineUnits`) carry base stats, class tags, traits and an optional auto-attack; a unit system spawns units with
 * their stats snapshotted, moves them through their lifecycle, derives their states from their aura tags
 * (`defineUnitStates`), keeps their health, and is the damage system's unit host.
 */

export {
  createUnitEvent,
  type HealthPolicy,
  type SpawnUnit,
  type UnitEvent,
  type UnitEvents,
  type UnitSystemBase,
  type UnitSystemOptions,
} from './engine.ts';

export type { AuraRule } from './hosts.ts';
export { defineUnitStates, type UnitBlock, type UnitStateDef, type UnitStateTable } from './states.ts';
export { createUnitSystem, type UnitSystem } from './system.ts';
export { defineUnitTags, type UnitTagDef, type UnitTagTable } from './tags.ts';
export { Unit, type UnitParts } from './unit.ts';

export {
  defineUnit,
  defineUnits,
  HEAVY,
  HOLDS_GROUND,
  IMMOVABLE,
  INERT,
  OBJECTIVE,
  PULL_IMMUNE,
  type UnitDef,
  type UnitRegistry,
  type UnitRegistryOptions,
  type UnitTraits,
} from './unit-def.ts';

export {
  type Lifecycle,
  LIFECYCLES,
  type UnitId,
  type UnitShape,
  type UnitTagId,
  type UnitTypes,
} from './unit-types.ts';
