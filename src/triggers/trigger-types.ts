import type { ConditionExpr } from '../conditions/index.ts';
import type { Proc, ProcTypes } from '../procs/index.ts';
import type { TriggerContext } from './dispatch.ts';

/**
 * The types one game's triggers are written against: the proc types plus the names of the game's trigger events and
 * event filters. A game declares its bundle once (`interface Game extends TriggerTypes { readonly trigger:
 * TriggerDef<Game>; … }`), so its auras list its triggers. Every name here is the game's.
 */
export interface TriggerTypes extends ProcTypes {
  /** The names of the events triggers answer: the bus kinds the game declares as trigger events. */
  readonly event: string;

  /** The names of the event filters the game's trigger events carry. */
  readonly filter: string;
}

/**
 * A test on the answered event's payload, which the game declares per event kind (`{ filter: 'minDamage', arg: 20 }`).
 * Its argument is a number, or a name the filter resolves to one at load (an aura's name). A filter the event does not
 * carry fails.
 */
export interface TriggerFilter<G extends TriggerTypes> {
  /** The filter. */
  readonly filter: G['filter'];

  /** Its argument; 0 when absent. */
  readonly arg?: number | string;
}

/**
 * One entry of a trigger's `when`: a condition tested on the trigger's owner (a game test, a
 * comparison, or their composition), or an event filter.
 */
export type TriggerCondition<G extends TriggerTypes> = ConditionExpr<G['condition'], G['valueKind']> | TriggerFilter<G>;

/**
 * One trigger, as data: on an event, when its conditions hold, with a chance and at most once per internal
 * cooldown, run procs. It lives on an aura only (`AuraDef.triggers`) and is active exactly while that aura is on its
 * bearer; its address is the aura and its index there.
 */
export interface TriggerDef<G extends TriggerTypes> {
  /** The event it answers. */
  readonly on: G['event'];

  /**
   * Whose events it hears: its owner's own (`self`, the default), or those of every unit of its owner's party
   * (`party`, the owner's included), as the host's `party` lists them.
   */
  readonly hears?: 'self' | 'party';

  /** What must hold, in order, every one of them: game conditions on the owner and filters on the event. */
  readonly when?: readonly TriggerCondition<G>[];

  /**
   * The odds it fires, in (0, 1], or read as it would fire from its context (a chance a stat or its aura's stacks
   * scale, a rate per minute from the time since it last fired), clamped to [0, 1]; rolled on the triggers' own stream
   * only when below 1, after the conditions.
   */
  readonly chance?: number | ((ctx: TriggerContext<G>) => number);

  /**
   * Its internal cooldown in seconds: after firing it is silent this long. Kept as a derived aura on the owner
   * (`icd.aura.<name>.<index>`, built by `withTriggerCooldowns`), so it is visible, cleansable and on the wire.
   */
  readonly icd?: number;

  /** What it does, in order: procs landing on `self` (the owner) unless they say `eventUnit`, `party` or a unit. */
  readonly do: readonly Proc<G>[];
}

/** Fixes a trigger's types; returns it unchanged. */
export const defineTrigger = <G extends TriggerTypes = TriggerTypes>(def: TriggerDef<G>): TriggerDef<G> => def;

/** Whether an unknown value is shaped like a trigger definition: what the trigger system checks at load. */
export const isTriggerDef = <G extends TriggerTypes>(value: unknown): value is TriggerDef<G> =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'on') === 'string' &&
  Array.isArray(Reflect.get(value, 'do'));
