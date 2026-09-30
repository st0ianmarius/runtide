import type { AuraItem } from './active-aura.ts';
import type { AuraApplication } from './application.ts';
import type { Restack } from './aura-def.ts';
import type { AuraTypes } from './aura-types.ts';
import { CUSTOM_MERGE, CUSTOM_STACKING, MERGES, STACKINGS } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { type AuraSet, setOf } from './state.ts';

/** What a re-application lands on. */
export interface Again<G extends AuraTypes> {
  /** The instance already there. */
  readonly item: AuraItem<G>;

  /** The application. */
  readonly application: AuraApplication<G>;

  /** Its length in seconds. */
  readonly seconds: number;
}

/** The code of `refresh`. */
const REFRESH = STACKINGS.indexOf('refresh');

/** The code of `extend`. */
const EXTEND = STACKINGS.indexOf('extend');

/** The code of `stack`. */
const STACK = STACKINGS.indexOf('stack');

/** The code of `highest`. */
const HIGHEST = STACKINGS.indexOf('highest');

/** The code of the `max` merge. */
const MAX = MERGES.indexOf('max');

/** The code of the `add` merge. */
const ADD = MERGES.indexOf('add');

/** The stacks an application adds: `max(1, floor(stacks))` (§II.6 A14). */
export const addedStacks = (application: AuraApplication): number => Math.max(1, Math.floor(application.stacks ?? 1));

/** The code of the stacking rule a re-application follows: its own built-in rule, else the definition's. */
const codeOf = <G extends AuraTypes>(engine: AuraEngine<G>, at: Again<G>): number =>
  at.application.stacking === undefined
    ? (engine.stacking[at.item.id] ?? 0)
    : STACKINGS.indexOf(at.application.stacking);

/** `extend`: the new length's ticks added to the end; the duration becomes the new time left. */
const extend = <G extends AuraTypes>(engine: AuraEngine<G>, set: AuraSet<G>, at: Again<G>): void => {
  const { item, seconds } = at;

  if (item.end === Infinity || !Number.isFinite(seconds)) {
    engine.setClock(set, item, engine.remainingOf(set, item) + seconds);

    return;
  }

  item.end += engine.stepsFor(item, seconds);
  item.duration = engine.remainingOf(set, item);
};

/** `highest`: whether the new length outlasts what is left, in ticks. */
const isLonger = <G extends AuraTypes>(engine: AuraEngine<G>, set: AuraSet<G>, at: Again<G>): boolean => {
  const { item, seconds } = at;

  if (!Number.isFinite(seconds)) {
    return seconds > engine.remainingOf(set, item);
  }

  return (set.clocks[item.clock] ?? 0) + engine.stepsFor(item, seconds) > item.end;
};

/**
 * A built-in rule on the instance already there; true when the clock or the stacks changed. It compares and adds in
 * whole ticks.
 */
const builtIn = <G extends AuraTypes>(engine: AuraEngine<G>, set: AuraSet<G>, at: Again<G>): boolean => {
  const { item, seconds } = at;
  const code = codeOf(engine, at);

  if (code === REFRESH) {
    engine.setClock(set, item, seconds);
  } else if (code === EXTEND) {
    extend(engine, set, at);
  } else if (code === STACK) {
    item.stacks = Math.min(engine.maxStacks[item.id] ?? 1, item.stacks + addedStacks(at.application));
    engine.setClock(set, item, seconds);
  } else if (code === HIGHEST && isLonger(engine, set, at)) {
    engine.setClock(set, item, seconds);
  } else {
    return false;
  }

  return true;
};

/** The game's own stacking rule on the instance already there; true when the clock or the stacks changed. */
const custom = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], at: Again<G>): boolean => {
  const { item, seconds } = at;
  const rule = engine.registry.get(item.id).stacking;
  const set = setOf<G>(bearer);

  if (typeof rule !== 'function') {
    return false;
  }

  const maxStacks = engine.maxStacks[item.id] ?? 1;

  const incoming = {
    seconds,
    stacks: addedStacks(at.application),
    remaining: engine.remainingOf(set, item),
    maxStacks,
  };

  const context = engine.events.take(bearer, item);
  let outcome: Restack | undefined;

  try {
    outcome = rule(context, incoming);
  } finally {
    engine.events.give();
  }

  if (outcome === undefined) {
    return false;
  }

  const stacks = Math.min(maxStacks, Math.max(1, Math.floor(outcome.stacks ?? item.stacks)));
  const isStacked = stacks !== item.stacks;

  item.stacks = stacks;

  if (outcome.seconds !== undefined) {
    engine.setClock(set, item, outcome.seconds);
  }

  return isStacked || outcome.seconds !== undefined;
};

/** Merges an application's value into the instance's; true when the value changed. */
const mergeValue = <G extends AuraTypes>(engine: AuraEngine<G>, at: Again<G>): boolean => {
  const { item, application } = at;
  const def = engine.registry.get(item.id);
  const incoming = application.value ?? def.value;

  if (incoming === undefined) {
    return false;
  }

  const code = engine.merge[item.id] ?? 0;
  const current = item.value;
  let value = incoming;

  if (code === MAX) {
    value = Math.max(current, incoming);
  } else if (code === ADD) {
    value = current + incoming;
  } else if (code === CUSTOM_MERGE && typeof def.merge === 'function') {
    value = def.merge(current, incoming);
  }

  item.value = value;

  return !Object.is(value, current);
};

/**
 * Lands a re-application on the instance already there by its stacking rule (the application's own built-in rule,
 * the definition's, or the game's function), then merges its value. True when anything changed.
 */
export const restack = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], at: Again<G>): boolean => {
  const isRestacked =
    codeOf(engine, at) === CUSTOM_STACKING ? custom(engine, bearer, at) : builtIn(engine, setOf<G>(bearer), at);

  return mergeValue(engine, at) || isRestacked;
};
