import type { TimerId } from '../ai/index.ts';
import type { Id } from '../core/index.ts';
import type { Proc, ProcOutcome } from '../procs/index.ts';
import type { UnitTypes } from '../units/index.ts';

/** The id of a script: its position in the game's script registry (`defineScripts`). */
export type ScriptId = Id<'scripts'>;

/**
 * The types one game's scripts are written against: the unit types, and the game events a
 * behaviour may handle, by name, each with its payload (`{ damaged: DamageEvent; castEnd: SpellEvent }`).
 */
export interface ScriptTypes extends UnitTypes {
  /** The game events behaviours may handle, by name: each one's payload. */
  readonly scriptEvents: object;
}

/** The names of a game's script events. */
export type ScriptEventName<G extends ScriptTypes> = Extract<keyof G['scriptEvents'], string>;

/**
 * What a handler returns: procs run for its unit once it returns, or nothing. They run only while the handler's record
 * is still its unit's and the unit alive (or the handler is a `died` one): a handler that killed or despawned its own
 * unit has what it returns dropped.
 */
export type ScriptReturn<G extends ScriptTypes> = readonly (Proc<G> | undefined)[] | undefined;

/**
 * What every handler receives: its unit, its behaviour's own state on that unit, the host, and ways to run procs
 * now. It is reused, so a handler reads it while it runs and never keeps it.
 */
export interface ScriptCtx<G extends ScriptTypes, State = unknown> {
  /** The unit whose script runs. */
  readonly unit: G['bearer'];

  /**
   * This behaviour's state on the unit (`Behaviour.state`); `undefined` for a behaviour with none. An object state is
   * mutated in place; a primitive one never changes.
   */
  readonly state: State;

  /** The game's host: its world, its policies, its random streams. */
  readonly host: G['host'];

  /**
   * Runs procs for the unit now, before the handler returns; how many went off. Like what a handler returns, they run
   * only while its record is still its unit's and the unit alive (or the handler is a `died` one): 0 otherwise.
   */
  readonly run: (procs: ScriptReturn<G>) => number;

  /**
   * Applies one proc for the unit now, as `run` would, and returns what it did (`skipped` once the handler may no
   * longer run procs). The outcome is reused by the next apply at the same nesting level: copy what you need.
   */
  readonly apply: (proc: Proc<G>) => ProcOutcome;
}

/** A handler of one moment; declared as a method so a handler over a narrower state still fits. */
type Handler<G extends ScriptTypes, State, Args extends unknown[]> = {
  /** The handler. */
  bivarianceHack(ctx: ScriptCtx<G, State>, ...args: Args): ScriptReturn<G>;
}['bivarianceHack'];

/**
 * A behaviour: a few optional handlers and its own state on each unit. A script is a list of
 * them, and the framework decides nothing about what they do: phases, picking, reactions, sensors and summon lists are
 * the game's behaviours. The framework calls `spawn` once, `tick` in the unit's step, `timer` as the unit's timers come
 * due (delivered in its step), and `on[event]` as a bound game event reaches the unit; `died` and `revived` as it dies
 * and comes back. While the unit is dead its script stops: no step, no bound events, and its brain's timers held, so a
 * revive goes on where it left off (a behaviour that starts over says so in its `revived`).
 *
 * Its handlers run in the script's order, each moment's stopping once one kills its unit: when one behaviour's
 * `spawn` kills the unit, the later behaviours' `spawn` never runs, not even after a revive, and a bound event raised
 * from an earlier `spawn` can reach a later behaviour's `on` before its `spawn` ran.
 */
export interface Behaviour<G extends ScriptTypes, State = unknown> {
  /** Makes its state on a unit, as the unit spawns. */
  state?(this: void, unit: G['bearer']): State;

  /**
   * The unit spawned (after its `spawned` event). A unit a `spawned` listener killed never runs it: its record is
   * attached dead, its `died` handlers run instead, and its `revived` ones at the revive.
   */
  spawn?(this: void, ctx: ScriptCtx<G, State>): ScriptReturn<G>;

  /**
   * The unit died (after its auras heard it): its script stops until a revive. It runs nested inside whatever killed the
   * unit (another handler's procs, a blow), before that returns. A dead unit's script never hears its own despawn, so
   * this does all its cleanup.
   */
  died?(this: void, ctx: ScriptCtx<G, State>): ScriptReturn<G>;

  /**
   * The unit was revived: its script goes on with the state it had, which this may mutate when it is an object (a
   * primitive state cannot change). A unit spawned dead runs it at its revive, its `spawn` never having run.
   */
  revived?(this: void, ctx: ScriptCtx<G, State>): ScriptReturn<G>;

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
