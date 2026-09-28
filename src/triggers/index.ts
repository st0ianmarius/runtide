/**
 * Triggers (§I.6, §II.3.7, §II.3.11): event listeners that live on auras only, active while their aura is on its
 * bearer. A trigger answers one event kind with conditions, filters, a chance and an internal cooldown (a derived
 * aura), and runs procs; a system (`createTriggerSystem`) compiles and validates them at load and dispatches the bus's
 * events through its capped tier, owner first, then party listeners.
 */

export type { TriggerCheck, TriggerConditions } from './compile.ts';

export {
  type CooldownName,
  cooldownName,
  type CooldownOptions,
  triggerName,
  type WithCooldowns,
  withTriggerCooldowns,
} from './cooldowns.ts';

export type { TriggerContext } from './dispatch.ts';

export {
  auraTriggerEvent,
  type TriggerEvent,
  triggerEvent,
  type TriggerEventSpec,
  type TriggerFilterOf,
  type TriggerFilterSpec,
} from './events.ts';

export type { TriggerConditionExplanation, TriggerExplanation, TriggerFilterExplanation } from './explain.ts';
export type { TriggerId } from './trigger-id.ts';

export {
  defineTrigger,
  type TriggerCondition,
  type TriggerDef,
  type TriggerFilter,
  type TriggerTypes,
} from './trigger-types.ts';

export {
  createTriggerSystem,
  explainTrigger,
  explainTriggers,
  type TriggerBus,
  type TriggerSystem,
  type TriggerSystemOptions,
} from './system.ts';
