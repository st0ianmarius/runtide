/**
 * Damage, healing and force: one side-agnostic damage pipeline for any unit, in a documented stage order a game
 * extends with its own named stages: the ignore gates, the block roll, the attacker's outgoing multipliers and crit,
 * the mitigation rows, absorbs, `onLethal` and health, then the after-stages (`onDealt`, the events, the death
 * pipeline); a knockback is the game's own after-stage calling `force`. Damage kinds bypass the stages they name (true
 * damage skips block, mitigation and absorbs). A heal pipeline, a force pipeline and the death pipeline with its reward
 * slots sit beside it, and the `damage`, `heal`, `setHealth` and `force` proc kinds reach them all.
 */

export type { Blow, BlowSpec, BlowStep } from './blow.ts';
export { DAMAGE_STAGES, FORCE_STAGES, HEAL_STAGES } from './compile.ts';
export type { DamageCues } from './cues.ts';

export type {
  BlowStatus,
  BlowStop,
  DamageKindId,
  DamageTypes,
  ForceKind,
  ForceStatus,
  HealStatus,
  RollSlot
} from './damage-types.ts';

export type { Death } from './death.ts';

export {
  BLOW_STATUSES,
  type BlowSnapshot,
  copyBlow,
  createDamageEvent,
  createDeathEvent,
  createForceEvent,
  createHealEvent,
  type DamageEvent,
  type DamageEvents,
  damageTriggerEvent,
  type DeathEvent,
  deathTriggerEvent,
  type ForceEvent,
  type HealEvent,
  healTriggerEvent,
  type SpellNames
} from './events.ts';

export type { MitigationExplanation, MitigationRowExplanation } from './explain.ts';
export type { Force, ForceSpec } from './force.ts';
export type { Heal, HealSpec } from './heal.ts';

export { type DamageKindDef, type DamageKindTable, defineDamageKinds, TRUE_DAMAGE } from './kinds.ts';

export {
  defineMitigation,
  flat,
  type MitigationRowDef,
  type MitigationTable,
  type Penetration,
  percent
} from './mitigation.ts';

export type {
  BlowState,
  DamageHost,
  DamageStage,
  DamageSystemOptions,
  DeathStep,
  ForceStage,
  ForceState,
  HealOptions,
  HealStage,
  HealState
} from './options.ts';

export {
  damage,
  type DamageProc,
  type DamageProcKinds,
  type DamageProcs,
  type ForceProc,
  heal,
  type HealProc,
  type ProcAmount,
  pull,
  push,
  setHealth,
  type SetHealthProc
} from './procs.ts';

export type { StageDef, StagePosition } from './stage-order.ts';

export {
  type CompiledRollRow,
  defineRollTable,
  type RollEffect,
  type RollMode,
  type RollRow,
  type RollStat,
  type RollTable,
  type RollTableSpec,
  type RollValue
} from './rolls.ts';

export {
  createDamageSystem,
  type DamageSystem,
  type HealthCredit,
  type RollExplanation,
  type RollQuery
} from './system.ts';
