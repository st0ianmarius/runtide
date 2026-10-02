// Hot path: removals walk the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { ActiveAura, AuraItem } from './active-aura.ts';
import type { AuraCause } from './aura-def.ts';
import type { AuraId, AuraTagId, AuraTypes } from './aura-types.ts';
import { CHANGES } from './compile.ts';
import { BOUND_TO_SOURCE, KEEP_DEPLETED, STACKINGS } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { type AuraSet, setOf } from './state.ts';

/** The change code of `refreshed`. */
const REFRESHED = CHANGES.indexOf('refreshed');

/** The change code of `removed`. */
const REMOVED = CHANGES.indexOf('removed');

/** The change code of `expired`. */
const EXPIRED = CHANGES.indexOf('expired');

/** The code of the `independent` stacking rule. */
const INDEPENDENT = STACKINGS.indexOf('independent');

/**
 * Takes the aura at `index` off its bearer's list, shifting the rest down (no array is made). The last slot goes with
 * `pop`, never by setting the length: a length set to 0 drops the list's storage, and the bearer's next aura would
 * allocate it again, where `pop` keeps a small list's storage.
 */
const cut = <G extends AuraTypes>(engine: AuraEngine<G>, set: AuraSet<G>, index: number): void => {
  const id = set.items[index]?.id ?? 0;
  const beatClock = engine.tables.beatClock[id] ?? -1;

  set.buckets[id & 31] = (set.buckets[id & 31] ?? 1) - 1;

  if (beatClock >= 0) {
    set.beats[beatClock] = (set.beats[beatClock] ?? 0) - 1;
  }

  set.items.copyWithin(index, index + 1);
  set.items.pop();
};

/**
 * Makes the function that takes the aura at an index off its bearer and queues `change` for it: one per change, made
 * once, so a removal or an expiry passes its index alone, not an object built per call.
 */
const takeOffAs =
  (change: number) =>
  <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], index: number): void => {
    const set = setOf<G>(bearer);
    const item = set.items[index];

    if (item === undefined) {
      return;
    }

    const { id } = item;

    cut(engine, set, index);
    engine.unbind(bearer, item);
    set.changes += 1;
    engine.events.retire(item);
    engine.events.raise(change, bearer, item);
    engine.noteRemoved(bearer, id);
  };

/** Takes the aura at an index off its bearer and queues `removed` for it. */
export const takeOff = takeOffAs(REMOVED);

/** Takes the aura at an index off its bearer and queues `expired` for it. */
export const expireAt = takeOffAs(EXPIRED);

/**
 * Whether a removal takes an aura, given the removal's numeric argument. Matchers are module-level functions with the
 * argument passed in, so a removal allocates no closure.
 */
type Match<G extends AuraTypes> = (engine: AuraEngine<G>, item: AuraItem<G>, arg: number) => boolean;

/** Takes every instance of the aura `id`. */
const byId = <G extends AuraTypes>(_engine: AuraEngine<G>, item: AuraItem<G>, id: number): boolean => item.id === id;

/** Takes every aura granting the tag `tag`. */
const byTag = <G extends AuraTypes>(engine: AuraEngine<G>, item: AuraItem<G>, tag: number): boolean =>
  engine.tables.tagBits[item.id]?.has(tag) === true;

/** Takes every aura whose `removedOn` holds the state bit `bit`. */
const byState = <G extends AuraTypes>(engine: AuraEngine<G>, item: AuraItem<G>, bit: number): boolean =>
  ((engine.tables.removedOn[item.id] ?? 0) & (1 << bit)) !== 0;

/** Takes every aura bound to the source `source`. */
const bySource = <G extends AuraTypes>(engine: AuraEngine<G>, item: AuraItem<G>, source: number): boolean =>
  item.source === source && ((engine.flags[item.id] ?? 0) & BOUND_TO_SOURCE) !== 0;

/**
 * Removes every aura `match` accepts with `arg`, in list order, each raising `removed`; how many went. Dispatches
 * nothing.
 */
const strip = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  match: Match<G>,
  arg: number
): number => {
  const set = setOf<G>(bearer);
  let removed = 0;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item !== undefined && match(engine, item, arg)) {
      takeOff(engine, bearer, i);
      i -= 1;
      removed += 1;
    }
  }

  if (removed > 0) {
    engine.refreshTags(set);
  }

  return removed;
};

/** Runs a removal as one operation with its cause: strips, then dispatches its events. */
const removeWhere = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  cause: AuraCause,
  match: Match<G>,
  arg: number
): number => {
  const from = engine.events.open(cause);

  try {
    return strip(engine, bearer, match, arg);
  } finally {
    engine.events.close(from);
  }
};

/** Removes every instance of an aura; true when there was one. */
export const removeAura = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): boolean =>
  removeWhere(engine, bearer, 'remove', byId, id) > 0;

/** Removes every aura granting a tag (a cleanse or dispel); how many went. */
export const removeByTag = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], tag: AuraTagId): number =>
  removeWhere(engine, bearer, 'removeByTag', byTag, tag);

/**
 * A bearer enters a state: every aura on it hears `stateEntered` (its `onState`), in list order and dispatched first,
 * then every aura whose `removedOn` names the state goes; how many went.
 */
export const enterState = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  state: G['state']
): number => {
  const bit = engine.tables.stateNames.indexOf(state);

  if (bit < 0) {
    throw new RangeError(`There is no bearer state ${state}.`);
  }

  // The auras the state removes go even when an aura's `onState` throws, so none outlives it; then it throws.
  try {
    hearState(engine, bearer, bit);
  } catch (error) {
    removeWhere(engine, bearer, 'enterState', byState, bit);

    throw error;
  }

  return removeWhere(engine, bearer, 'enterState', byState, bit);
};

/** Every aura on a bearer hears it enter a state (its bit): `stateEntered`, in list order, dispatched at once. */
const hearState = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], bit: number): void => {
  const set = setOf<G>(bearer);
  const from = engine.events.open('enterState');

  try {
    for (let i = 0; i < set.items.length; i++) {
      const item = set.items[i];

      if (item !== undefined) {
        engine.events.raiseState(bearer, item, bit);
      }
    }
  } finally {
    engine.events.close(from);
  }
};

/**
 * Takes every aura off a bearer gone for good (a despawned unit), raising nothing: its auras heard the state it left
 * in already. Their slots go back to the pool; how many went.
 */
export const releaseAll = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer']): number => {
  const set = setOf<G>(bearer);
  const count = set.items.length;
  const from = engine.events.open('remove');

  for (let i = count - 1; i >= 0; i--) {
    const item = set.items.pop();

    if (item !== undefined) {
      engine.unbind(bearer, item);
      engine.events.retire(item);
    }
  }

  if (count > 0) {
    set.changes += 1;
    set.beats.fill(0);
    set.buckets.fill(0);
    set.due.fill(Number.POSITIVE_INFINITY);
    engine.refreshTags(set);
  }

  engine.events.close(from);

  return count;
};

/** Removes every aura bound to a source that is gone; how many went. */
export const sourceGone = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], source: number): number =>
  removeWhere(engine, bearer, 'sourceGone', bySource, source);

/**
 * A source left (died, despawned, went down): every aura bound to it comes off every bearer that holds one, found
 * through the engine's index, not by walking every bearer; how many went.
 */
export const sourceLeft = <G extends AuraTypes>(engine: AuraEngine<G>, source: number): number =>
  sourceGoneFrom(engine, engine.boundTo(source), source, 0);

/** Takes a source's bound auras off each bearer from `start`: one whose hook throws still has the rest go, then throws. */
const sourceGoneFrom = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearers: readonly G['bearer'][],
  source: number,
  start: number
): number => {
  let removed = 0;

  for (let i = start; i < bearers.length; i++) {
    const bearer = bearers[i];

    if (bearer === undefined) {
      continue;
    }

    try {
      removed += sourceGone(engine, bearer, source);
    } catch (error) {
      sourceGoneFrom(engine, bearers, source, i + 1);

      throw error;
    }
  }

  return removed;
};

/** The cleanse of an application: every tag its aura `removes`, tag by tag, each in list order. Dispatches nothing. */
export const cleanse = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): void => {
  const tags = engine.tables.removes[id];

  if (tags === undefined) {
    return;
  }

  for (let i = 0; i < tags.length; i++) {
    strip(engine, bearer, byTag, tags[i] ?? -1);
  }
};

/** The index of the instance of an aura with least time left (the first of equals), or -1 for none. */
const leastLeftOf = <G extends AuraTypes>(engine: AuraEngine<G>, set: AuraSet<G>, id: AuraId): number => {
  let least = -1;
  let leastLeft = Infinity;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item?.id !== id) {
      continue;
    }

    const left = engine.remainingOf(set, item);

    if (least < 0 || left < leastLeft) {
      least = i;
      leastLeft = left;
    }
  }

  return least;
};

/** At an `independent` aura's cap, removes the instance with least time left (the first of equals). */
export const evictFor = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): void => {
  const set = setOf<G>(bearer);
  let count = 0;

  if (engine.stacking[id] !== INDEPENDENT) {
    return;
  }

  for (let i = 0; i < set.items.length; i++) {
    count += set.items[i]?.id === id ? 1 : 0;
  }

  const least = leastLeftOf(engine, set, id);

  if (count >= (engine.maxStacks[id] ?? 1) && least >= 0) {
    takeOff(engine, bearer, least);
    engine.refreshTags(set);
  }
};

/** Spends stacks from an aura's instances in order; an instance left with none is removed. */
export const spendStacks = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  id: AuraId,
  count: number
): boolean => {
  const set = setOf<G>(bearer);
  let left = count;

  if (!Number.isInteger(left)) {
    throw new RangeError(`Stacks are spent whole; got ${left}.`);
  }

  if (left <= 0) {
    return true;
  }

  if (heldStacks(set, id) < left) {
    return false;
  }

  const from = engine.events.open('spendStacks');

  try {
    for (let i = 0; i < set.items.length && left > 0; i++) {
      const item = set.items[i];

      if (item?.id !== id) {
        continue;
      }

      const taken = Math.min(item.stacks, left);

      item.stacks -= taken;
      left -= taken;
      engine.isSpentEmpty = item.stacks <= 0;
      i -= spendOne(engine, bearer, i);
    }
  } finally {
    engine.refreshTags(set);
    engine.events.close(from);
  }

  return true;
};

/** Every stack of an aura held, summed over its instances. */
const heldStacks = <G extends AuraTypes>(set: AuraSet<G>, id: AuraId): number => {
  let stacks = 0;

  for (let i = 0; i < set.items.length; i++) {
    stacks += set.items[i]?.id === id ? (set.items[i]?.stacks ?? 0) : 0;
  }

  return stacks;
};

/**
 * Settles one spent instance at `index`: removed when its emptiness (`isEmpty`, read first) says so, else refreshed.
 * Returns 1 when it left the list. A spend hands its instance over by index and a flag in the engine, not in an object
 * built per instance.
 */
const spendOne = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], index: number): number => {
  const set = setOf<G>(bearer);
  const item = set.items[index];

  if (engine.isSpentEmpty) {
    takeOff(engine, bearer, index);

    return 1;
  }

  if (item !== undefined) {
    set.changes += 1;
    engine.events.raise(REFRESHED, bearer, item);
  }

  return 0;
};

/**
 * Spends an amount from an aura's value, instance by instance in order (an absorb eating a blow), or from one instance
 * alone when `only` names it (the instance whose hook absorbed); an instance spent to 0 is removed unless its aura
 * keeps it when depleted. Returns the amount spent.
 */
export const spendValue = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  id: AuraId,
  asked: number,
  only?: ActiveAura
): number => {
  const amount = Number.isNaN(asked) ? 0 : Math.max(0, asked);
  const set = setOf<G>(bearer);
  const from = engine.events.open('spendValue');
  const keeps = ((engine.flags[id] ?? 0) & KEEP_DEPLETED) !== 0;
  let left = amount;

  try {
    for (let i = 0; i < set.items.length && left > 0; i++) {
      const item = set.items[i];

      if (item?.id !== id || !(item.value > 0) || (only !== undefined && item !== only)) {
        continue;
      }

      const taken = Math.min(item.value, left);

      item.value -= taken;
      left -= taken;
      engine.isSpentEmpty = item.value <= 0 && !keeps;
      i -= spendOne(engine, bearer, i);
    }
  } finally {
    engine.refreshTags(set);
    engine.events.close(from);
  }

  return amount - left;
};

/** Sets the clock of every instance of an aura again (to `seconds`, or its own length); true when there was one. */
export const refreshAura = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  id: AuraId,
  seconds?: number
): boolean => {
  const set = setOf<G>(bearer);
  const from = engine.events.open('refresh');
  let found = false;

  try {
    for (let i = 0; i < set.items.length; i++) {
      const item = set.items[i];

      if (item?.id === id) {
        engine.setClock(set, item, seconds ?? engine.lengthOf(id, bearer));
        set.changes += 1;
        engine.events.raise(REFRESHED, bearer, item);
        found = true;
      }
    }
  } finally {
    engine.events.close(from);
  }

  return found;
};
