/**
 * Procs (§I.6, §II.3.6): one vocabulary for every outcome a spell, an aura or a trigger sets off. A proc is plain
 * data with a `kind`; a registry (`createProcRegistry({ ...CORE_PROCS, ...GAME_PROCS })`) gives each kind a dense id
 * to dispatch on, and a system (`createProcSystem`) runs lists in order with chance, groups, kill tracking and a
 * depth cap, landing auras through the aura system and everything else through the host.
 */

export {
  andThen,
  applyAura,
  type ChanceOption,
  cue,
  grant,
  group,
  pickOne,
  raise,
  removeAura,
  removeByTag,
  run,
  type TargetOptions,
} from './builders.ts';

export { CORE_PROCS, type CoreProcKind, type CoreProcName } from './core-procs.ts';
export { type EscapeDamage, type EscapeReport, escapeReport, type EscapeRun, type EscapeSpells } from './escape.ts';
export { explainProc, type ProcExplanation, type ProcTargetKind } from './explain.ts';

export type {
  AndThenProc,
  ApplyAuraProc,
  CoreProc,
  CueProc,
  EventProc,
  GrantProc,
  GroupProc,
  PickOneProc,
  Proc,
  RemoveAuraProc,
  RemoveByTagProc,
  RunProc,
} from './proc-data.ts';

export { defineProcKind, type ProcDetail, type ProcKindDef, type ProcKinds, type ProcResolver } from './proc-kind.ts';

export {
  PROC_LANDED,
  PROC_REFUSED,
  PROC_SKIPPED,
  type ProcBus,
  type ProcContext,
  type ProcHost,
  type ProcOrigin,
  type ProcOutcome,
  procOutcome,
  type ProcShape,
  type ProcStatus,
  type ProcTarget,
  type ProcTypes,
} from './proc-types.ts';

export { createProcRegistry, type ProcKindId, type ProcRegistry } from './registry.ts';
export { createProcSystem, type ProcSystem, type ProcSystemOptions } from './system.ts';
