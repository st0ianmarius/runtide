// Hot path (§I.4.2, §I.5.4): applications walk the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { type AuraItem, NO_SOURCE } from './active-aura.ts';
import type { ApplyResult, AuraApplication } from './application.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';
import { CHANGES } from './compile.ts';
import { CREDIT_FIRST, PER_SOURCE, STACKINGS } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { cleanse, evictFor } from './remove.ts';
import { addedStacks, restack } from './restack.ts';
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

/** A re-application that changed nothing (a losing `highest`, a `keep` with no new value). */
const UNCHANGED: ApplyResult = Object.freeze({ applied: true, fresh: false, changed: false });

/** The instance an application lands on: the one shared instance, or the source's own; none for `independent`. */
const existingFor = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  set: AuraSet<G>,
  application: AuraApplication<G>,
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

/** Runs the aura's `onLand` hook for an instance an application landed on. */
const land = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  at: { readonly bearer: G['bearer']; readonly item: AuraItem<G> },
  application: AuraApplication<G>,
): void => {
  const onLand = engine.registry.hooks.onLand[at.item.id];

  if (onLand === undefined) {
    return;
  }

  const context = engine.events.take(at.bearer, at.item);

  try {
    onLand(context, application);
  } finally {
    engine.events.give();
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
const fresh = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  at: { readonly application: AuraApplication<G>; readonly seconds: number },
): AuraItem<G> => {
  const { application, seconds } = at;
  const set = setOf<G>(bearer);
  const id = application.aura;
  const item = engine.acquire(id);
  const isOwnInstance = engine.stacking[id] === INDEPENDENT || ((engine.flags[id] ?? 0) & PER_SOURCE) !== 0;
  const maxStacks = engine.maxStacks[id] ?? 1;

  engine.events.setCause('evict');
  evictFor(engine, bearer, id);
  engine.events.setCause('apply');
  item.serial = isOwnInstance ? (engine.serials += 1) : 0;
  item.stacks = Math.min(maxStacks, engine.stacking[id] === STACK ? addedStacks(application) : 1);
  item.value = application.value ?? engine.registry.get(id).value ?? 0;
  item.source = application.source ?? NO_SOURCE;
  engine.setClock(set, item, seconds);
  engine.insert(set, item);
  engine.refreshTags(set);
  item.nextBeat = firstBeat(engine, bearer, item);
  set.changes += 1;

  if (engine.registry.has.onLand.has(id)) {
    land(engine, { bearer, item }, application);
  }

  engine.events.raise(APPLIED, bearer, item);

  return item;
};

/** Lands a re-application on the instance already there; true when it changed anything. */
const again = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  at: { readonly item: AuraItem<G>; readonly application: AuraApplication<G>; readonly seconds: number },
): boolean => {
  const { item, application } = at;
  const isChanged = restack(engine, bearer, at);

  if (application.source !== undefined && ((engine.flags[item.id] ?? 0) & CREDIT_FIRST) === 0) {
    item.source = application.source;
  }

  if (engine.registry.has.onLand.has(item.id)) {
    land(engine, { bearer, item }, application);
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

/** Runs the grants of an application that landed. */
const grant = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], item: AuraItem<G>): void => {
  const grants = engine.registry.defs[item.id]?.grants;

  if (grants === undefined || grants.length === 0 || setOf<G>(bearer).isSilent) {
    return;
  }

  const context = engine.events.take(bearer, item);

  try {
    engine.events.run(grants, context);
  } finally {
    engine.events.give();
  }
};

/**
 * Lands one application by its aura's rules (after the host's policy): a `blockedBy` tag turns it away before
 * anything else, `removes` cleanses next, then it lands fresh or on the instance already there; its grants run,
 * then its lifecycle events are dispatched.
 */
const landAura = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  application: AuraApplication<G>,
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

  cleanse(engine, bearer, id);
  engine.events.setCause('apply');

  const existing = existingFor(engine, set, application);
  let result = FRESH;
  let landed = existing;

  if (existing === undefined) {
    landed = fresh(engine, bearer, { application, seconds });
  } else {
    result = again(engine, bearer, { item: existing, application, seconds }) ? CHANGED : UNCHANGED;
  }

  if (landed !== undefined) {
    grant(engine, bearer, landed);
  }

  engine.events.close(from);

  return result;
};

/**
 * Applies an aura to a bearer (§II.3.8): the host's application policy first (refuse, replace, then more), then the
 * aura's own rules. A refusal raises nothing.
 */
export const applyAura = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  input: AuraId | AuraApplication<G>,
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
