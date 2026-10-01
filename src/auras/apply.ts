// Hot path: applications walk the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { type AuraItem, NO_SOURCE } from './active-aura.ts';
import type { ApplyResult, AuraApplication } from './application.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';
import { CHANGES } from './compile.ts';
import { CREDIT_FIRST, CUSTOM_STACKING, PER_SOURCE, STACKINGS } from './define-auras.ts';
import type { AuraEngine, Landing } from './engine.ts';
import { cleanse, evictFor } from './remove.ts';
import { addedStacks, restack, stackingOf } from './restack.ts';
import { type AuraSet, setOf } from './state.ts';

/** The change code of `applied`. */
const APPLIED = CHANGES.indexOf('applied');

/** The change code of `refreshed`. */
const REFRESHED = CHANGES.indexOf('refreshed');

/** The code of the `independent` stacking rule. */
const INDEPENDENT = STACKINGS.indexOf('independent');

/** The code of the `stack` stacking rule. */
const STACK = STACKINGS.indexOf('stack');

/** A refused application: nothing landed, nothing changed. */
const REFUSED: ApplyResult = Object.freeze({ applied: false, fresh: false, changed: false });

/** A fresh instance. */
const FRESH: ApplyResult = Object.freeze({ applied: true, fresh: true, changed: true });

/** A re-application that changed the instance. */
const CHANGED: ApplyResult = Object.freeze({ applied: true, fresh: false, changed: true });

/** A re-application that changed nothing (a losing `highest` whose value merge changed nothing too). */
const UNCHANGED: ApplyResult = Object.freeze({ applied: true, fresh: false, changed: false });

/** The instance an application lands on: the one shared instance, or the source's own; none for `independent`. */
const existingFor = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  set: AuraSet<G>,
  application: AuraApplication<G>
): AuraItem<G> | undefined => {
  const id = application.aura;

  if (engine.stacking[id] === INDEPENDENT) {
    return undefined;
  }

  const isPerSource = ((engine.flags[id] ?? 0) & PER_SOURCE) !== 0;
  const source = application.source ?? NO_SOURCE;
  const { items } = set;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item?.id === id && (!isPerSource || item.source === source)) {
      return item;
    }
  }

  return undefined;
};

/** Runs the aura's `onLand` hook for the instance a landing landed on. */
const land = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], landing: Landing<G>): void => {
  const { item, application } = landing;
  const onLand = engine.registry.hooks.onLand[item.id];

  if (onLand === undefined) {
    return;
  }

  const context = engine.events.take(bearer, item);

  // Held, so an onLand that removes its own aura cannot hand its slot to one it applies before this one's event is raised.
  engine.events.hold();

  try {
    onLand(context, application);
  } finally {
    engine.events.give();
    engine.events.unhold();
  }
};

/** The seconds until an aura's first beat, read from its period. */
const firstBeat = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], item: AuraItem<G>): number => {
  const every = engine.registry.defs[item.id]?.periodic?.every;

  if (typeof every !== 'function') {
    return every ?? 0;
  }

  const context = engine.events.take(bearer, item);

  try {
    return every(context);
  } finally {
    engine.events.give();
  }
};

/** Lands a fresh instance: evicts at the cap, fills it, inserts it in order and queues `applied`. */
const fresh = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], landing: Landing<G>): AuraItem<G> => {
  const { application, seconds } = landing;
  const set = setOf<G>(bearer);
  const id = application.aura;
  const item = engine.acquire(id);

  const isOwnInstance = engine.stacking[id] === INDEPENDENT || ((engine.flags[id] ?? 0) & PER_SOURCE) !== 0;

  const maxStacks = engine.maxStacks[id] ?? 1;

  engine.events.setCause('evict');
  evictFor(engine, bearer, id);
  engine.events.setCause('apply');
  item.serial = isOwnInstance ? (set.serials += 1) : 0;
  const stacking = stackingOf(engine, application);

  item.stacks = Math.min(maxStacks, stacking === STACK || stacking === CUSTOM_STACKING ? addedStacks(application) : 1);
  item.value = application.value ?? engine.registry.get(id).value ?? 0;
  item.source = application.source ?? NO_SOURCE;
  engine.setClock(set, item, seconds);
  engine.insert(set, item);
  engine.refreshTags(set);
  set.changes += 1;
  item.nextBeat = firstBeat(engine, bearer, item);

  if (engine.registry.has.onLand.has(id)) {
    landing.item = item;
    land(engine, bearer, landing);
  }

  engine.events.raise(APPLIED, bearer, item);

  return item;
};

/** Lands a re-application on the instance already there (the landing's item); true when it changed anything. */
const again = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], landing: Landing<G>): boolean => {
  const { item, application } = landing;
  const isChanged = restack(engine, bearer, landing);

  if (
    application.source !== undefined &&
    application.source !== item.source &&
    ((engine.flags[item.id] ?? 0) & CREDIT_FIRST) === 0
  ) {
    // A new source alone is no refresh, but readers diffing the list (views, seeds) see it.
    item.source = application.source;
    setOf<G>(bearer).changes += 1;
  }

  if (engine.registry.has.onLand.has(item.id)) {
    land(engine, bearer, landing);
  }

  if (isChanged) {
    setOf<G>(bearer).changes += 1;
    engine.events.raise(REFRESHED, bearer, item);
  }

  return isChanged;
};

/** Throws unless an application's length is sound. */
const checkSeconds = <G extends AuraTypes>(engine: AuraEngine<G>, id: AuraId, seconds: number): void => {
  if (Number.isNaN(seconds) || seconds < 0) {
    throw new RangeError(`Aura ${engine.registry.name(id)}: a length must be seconds from 0; got ${seconds}.`);
  }
};

/**
 * Lands one application by its aura's rules (after the host's policy): a `blockedBy` tag turns it away before
 * anything else, `removes` cleanses next, then it lands fresh or on the instance already there, then its lifecycle
 * events are dispatched.
 */
const landAura = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  application: AuraApplication<G>
): ApplyResult => {
  const set = setOf<G>(bearer);
  const id = application.aura;
  const blockedBy = engine.tables.blockedBy[id];

  if (engine.registry.isRetired(id) || (blockedBy !== undefined && set.tags.intersects(blockedBy))) {
    return REFUSED;
  }

  const seconds = application.duration ?? engine.lengthOf(id, bearer);

  checkSeconds(engine, id, seconds);

  const from = engine.events.open('cleanse');
  const landing = engine.takeLanding(application, seconds);
  let result = FRESH;

  try {
    cleanse(engine, bearer, id);
    engine.events.setCause('apply');

    const existing = existingFor(engine, set, application);

    if (existing === undefined) {
      fresh(engine, bearer, landing);
    } else {
      landing.item = existing;
      result = again(engine, bearer, landing) ? CHANGED : UNCHANGED;
    }
  } finally {
    engine.giveLanding();
    engine.events.close(from);
  }

  return result;
};

/**
 * Applies an aura to a bearer: the host's application policy first (refuse, replace, then more), then the
 * aura's own rules. A refusal raises nothing.
 */
export const applyAura = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  input: AuraId | AuraApplication<G>
): ApplyResult => {
  const incoming = typeof input === 'number' ? engine.applicationOf(input) : input;
  const decision = engine.host.onIncomingAura?.(bearer, incoming);

  if (decision?.refuse === true) {
    return REFUSED;
  }

  const result = landAura(engine, bearer, decision?.apply ?? incoming);

  if (result.applied && decision?.after !== undefined) {
    for (const next of decision.after) {
      landAura(engine, bearer, next);
    }
  }

  return result;
};
