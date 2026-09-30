/**
 * Spells: the container that ties the other systems together. A spell is plain data and
 * standalone hooks (`defineSpell`), registered by name (`defineSpells`): who pulls its trigger (an activation kind),
 * how strong it is (a stats table of scaled values, or a function), where it goes, how its cast unfolds in time (a
 * timeline of windup, channel and recovery), and the procs it runs at each moment.
 */

export {
  type Activation,
  type ActivationKindDef,
  type ActivationRegistry,
  type AutoActivation,
  type ButtonActivation,
  type ButtonCost,
  type CastSeconds,
  CORE_ACTIVATIONS,
  type CoreActivation,
  defineActivationKind,
  defineActivations,
  isButton,
  type PassiveActivation,
  type TriggerActivation
} from './activation.ts';

export type { CasterState } from './caster.ts';
export type { CompiledStats } from './compile-stats.ts';

export {
  defineSpells,
  type SpellColumn,
  type SpellHookName,
  type SpellHookTables,
  type SpellRegistry,
  type SpellRegistryOptions
} from './define-spells.ts';

export { autoNext, type ClockScale } from './auto.ts';
export type { SpellClock } from './engine.ts';

export { CAST_OUTCOMES, createSpellEvent, type SpellEvent, type SpellEvents, spellTriggerEvent } from './events.ts';

export {
  explainSpell,
  type PreviewOptions,
  previewStats,
  type SpellExplanation,
  type SpellStatExplanation
} from './explain.ts';

export { type CastHandle, NO_CAST } from './ids.ts';
export { type MirrorCtx, OPEN_WORLD, type StaticWorld } from './mirror.ts';
export type { ProcOut } from './proc-out.ts';

export {
  after,
  type AfterProc,
  castSpell,
  type CastSpellProc,
  type DelayBound,
  rescaleClocks,
  type RescaleClocksProc,
  type SpellProcKinds,
  type SpellProcs
} from './procs.ts';

export {
  type AnySpellDef,
  type CastOutcome,
  type CastStage,
  defineSpell,
  type GateContext,
  type ProcReturn,
  type ScaledOf,
  type SpellContext,
  type SpellCooldown,
  type SpellCues,
  type SpellDef,
  type SpellHit,
  type StatsContext,
  type StatsOf,
  type StatsSource
} from './spell-def.ts';

export type { Reach, ReachRefusal } from './reach.ts';
export type { CastOptions, CastRefusal, CastReport, GateAnswer } from './cast-request.ts';
export type { SpellHost } from './spell-host.ts';

export type { ActivationKindId, ActivationShape, SpellCaster, SpellId, SpellTagId, SpellTypes } from './spell-types.ts';

export type { SpellSystem } from './spell-system.ts';
export { createSpellSystem } from './system.ts';
export type { SpellSystemBase, SpellSystemOptions } from './system-options.ts';

export { defineSpellTags, type SpellTagDef, type SpellTagTable } from './tags.ts';

export {
  type Channel,
  lockBefore,
  type Recover,
  type Timeline,
  type Track,
  type TrackContext,
  type Windup
} from './timeline.ts';

export { CAST_STAGES, type CastView } from './view.ts';
