/**
 * Creature scripts (§I.7.1 F19): places for a creature's own logic, and no logic of their own. A script is a list of
 * behaviours (`defineBehaviour`, `defineScripts`), each a few optional handlers with its own state per unit: `spawn`,
 * `tick` in the unit's step, `timer` as its timers come due (delivered in its step), and the game's own bus events
 * routed to the unit a binding names. Phases, picking, reactions, sensors and summon lists are the game's behaviours,
 * built from the AI toolkit, the spell system and summons.
 */

export type { CompiledScript, ScriptRegistry } from './define-scripts.ts';
export { defineScripts } from './define-scripts.ts';

export {
  type AnyBehaviour,
  type AnyEventHandler,
  type Behaviour,
  defineBehaviour,
  type ScriptCtx,
  type ScriptEventName,
  type ScriptId,
  type ScriptReturn,
  type ScriptTypes,
} from './script-types.ts';

export {
  createScriptSystem,
  type ScriptBus,
  type ScriptEventBinding,
  type ScriptEventBindings,
  type ScriptSystem,
  type ScriptSystemOptions,
} from './system.ts';
