import type { TimerId } from '../ai/index.ts';
import type { Id } from '../core/index.ts';
import type { Proc } from '../procs/index.ts';
import type { UnitTypes } from '../units/index.ts';

/** The id of a creature script: its position in the game's script registry (`defineScripts`). */
export type ScriptId = Id<'scripts'>;

/**
 * The types one game's creature scripts are written against (§I.7.1 F19): the unit types, and the game events a
 * behaviour may handle, by name, each with its payload (`{ damaged: DamageEvent; castEnd: SpellEvent }`).
 */
export interface ScriptTypes extends UnitTypes {
  /** The game events behaviours may handle, by name: each one's payload. */
  readonly scriptEvents: object;
}

/** The names of a game's script events. */
export type ScriptEventName<G extends ScriptTypes> = Extract<keyof G['scriptEvents'], string>;

/** What a handler returns: procs run for its unit once it returns, or nothing. */
export type ScriptReturn<G extends ScriptTypes> = readonly (Proc<G> | undefined)[] | undefined;

/**
 * What every handler receives: its unit, its behaviour's own state on that unit, the host, and a way to run procs
 * now. It is reused, so a handler reads it while it runs and never keeps it.
 */
export interface ScriptCtx<G extends ScriptTypes, State = unknown> {
  /** The unit whose script runs. */
  readonly unit: G['bearer'];

  /** This behaviour's state on the unit (`Behaviour.state`); `undefined` for a behaviour with none. */
  readonly state: State;

  /** The game's host: its world, its policies, its random streams. */
  readonly host: G['host'];

  /** Runs procs for the unit now, before the handler returns; how many went off. */
  readonly run: (procs: ScriptReturn<G>) => number;
}

/** A handler of one moment; declared as a method so a handler over a narrower state still fits. */
type Handler<G extends ScriptTypes, State, Args extends unknown[]> = {
  /** The handler. */
  bivarianceHack(ctx: ScriptCtx<G, State>, ...args: Args): ScriptReturn<G>;
}['bivarianceHack'];

/**
 * A behaviour (§I.7.1 F19): a few optional handlers and its own state on each unit. A creature script is a list of
 * them, and the framework decides nothing about what they do: phases, picking, reactions, sensors and summon lists are
 * the game's behaviours. The framework calls `spawn` once, `tick` in the unit's step, `timer` as the unit's timers come
 * due (delivered in its step), and `on[event]` as a bound game event reaches the unit.
 */
export interface Behaviour<G extends ScriptTypes, State = unknown> {
  /** Makes its state on a unit, as the unit spawns. */
  state?(this: void, unit: G['bearer']): State;

  /** The unit spawned (after its `spawned` event). */
  spawn?(this: void, ctx: ScriptCtx<G, State>): ScriptReturn<G>;

  /** The unit's step (`scripts.step`): only behaviours that need per-tick work declare it. */
  tick?(this: void, ctx: ScriptCtx<G, State>): ScriptReturn<G>;

  /** One of the unit's timers came due (F17), delivered in its step, in due order. */
  timer?(this: void, ctx: ScriptCtx<G, State>, timer: TimerId): ScriptReturn<G>;

  /** Bound game events reaching the unit, by name. */
  readonly on?: {
    readonly [Event in ScriptEventName<G>]?: Handler<G, State, [payload: G['scriptEvents'][Event]]>;
  };
}

/** A handler of any event, whatever its payload and state: how the system holds and calls them. */
export type AnyEventHandler<G extends ScriptTypes> = Handler<G, unknown, [payload: unknown]>;

/** Any behaviour of a game, whatever its state: what a script lists. */
export type AnyBehaviour<G extends ScriptTypes> = Behaviour<G>;

/**
 * Fixes a behaviour's game types and returns the identity that infers its state: `const behaviour =
 * defineBehaviour<Game>();` then `export const enrage = behaviour({ state: () => ({ isEnraged: false }), … })`.
 */
export const defineBehaviour =
  <G extends ScriptTypes>() =>
  <State = undefined>(behaviour: Behaviour<G, State>): Behaviour<G, State> =>
    behaviour;
