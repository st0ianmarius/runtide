/**
 * Scripts: places for a unit's own logic, and no logic of their own, for creatures and for the world
 * alike. A script is a list of behaviours (`defineBehaviour`, `defineScripts`), each a few optional handlers with its
 * own state per unit: `spawn`, `tick` in the unit's step, `timer` as its
 * timers come due (delivered in its step), and the game's own bus events routed to the unit a binding names. A world
 * script (a map event, a formation, a world clock) is a script on a bodiless unit whose spawn names it. Phases,
 * picking, reactions, sensors and summon lists are the game's behaviours, built from the AI toolkit, the spell system
 * and summons.
 */

export type { CompiledScript, ScriptRegistry, ScriptRegistryOptions } from './define-scripts.ts';
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
