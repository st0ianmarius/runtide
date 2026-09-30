/**
 * Auras: timed states on any bearer, WoW style. Definitions are plain data and standalone hooks
 * (`defineAura`, `defineAuras`); a system (`createAuraSystem`) applies, stacks, beats, expires and removes them on
 * any bearer holding an aura state, feeds their modifiers to the modifier system through its gates, keeps the bearer's
 * tag bitset, and runs every lifecycle hook and event through a narrow host and the bus.
 */

export { type ActiveAura, type AuraContext, NO_SOURCE } from './active-aura.ts';

export type { ApplyResult, AuraApplication, AuraDecision, AuraHost } from './application.ts';

export {
  type AuraChange,
  type AuraDef,
  type AuraHook,
  type AuraMerge,
  type AuraMergeRule,
  type AuraPeriodic,
  type AuraStacking,
  type AuraStackingRule,
  defineAura,
  type IncomingAura,
  type Restack
} from './aura-def.ts';

export type { AuraId, AuraTagId, AuraTypes } from './aura-types.ts';
export type { AuraClock, AuraModifiers } from './compile.ts';
export { auraCue, checkAuraCues } from './cues.ts';

export type {
  AuraDamageHooks,
  BlowChange,
  ForceChange,
  HealChange,
  LethalOutcome,
  OutgoingChange
} from './damage-hooks.ts';

export {
  AURA_HOOKS,
  type AuraColumn,
  type AuraHookName,
  type AuraHookTables,
  type AuraRegistry,
  defineAuras,
  type GameHookTables
} from './define-auras.ts';

export { type AuraEvent, type AuraEventBus, createAuraEvent } from './aura-event.ts';
export type { AuraExplanation } from './explain.ts';
export { type AuraBearer, auraGates, auraRevision, auraStacks, type AuraState } from './state.ts';
export type { Dispel } from './dispel.ts';

export type { AuraPipelineHook, CollectedHook } from './collect.ts';

export {
  type AuraSystem,
  type AuraSystemBase,
  type AuraSystemOptions,
  createAuraSystem,
  explainAura,
  type StateOptions
} from './system.ts';

export { type AuraTagDef, type AuraTagTable, defineAuraTags } from './tags.ts';
export type { AuraSeed } from './seed.ts';
export type { AuraView, ViewOptions } from './view.ts';
