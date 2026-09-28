// Hot path (§I.4.2, §I.5.4): removals walk the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { AuraItem } from './active-aura.ts';
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

/** The change code of `bearerDeath`. */
const BEARER_DEATH = CHANGES.indexOf('bearerDeath');

/** The code of the `independent` stacking rule. */
const INDEPENDENT = STACKINGS.indexOf('independent');

/** Takes the aura at `index` off its bearer's list, shifting the rest down (no array is made). */
const cut = <G extends AuraTypes>(set: AuraSet<G>, index: number): void => {
  set.items.copyWithin(index, index + 1);
  set.items.length -= 1;
};

/** Takes the aura at `index` off its bearer and queues `change` (`removed` or `expired`) for it. */
export const takeOff = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  at: { readonly index: number; readonly change: number },
): void => {
  const set = setOf<G>(bearer);
  const item = set.items[at.index];

  if (item === undefined) {
    return;
  }

  cut(set, at.index);
  set.changes += 1;
  engine.events.retire(item);
  engine.events.raise(at.change, bearer, item);
};

/** Removes every aura `match` accepts, in list order, each raising `removed`; how many went. Dispatches nothing. */
const strip = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  match: (item: AuraItem<G>) => boolean,
): number => {
  const set = setOf<G>(bearer);
  let removed = 0;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item !== undefined && match(item)) {
      takeOff(engine, bearer, { index: i, change: REMOVED });
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
  removal: { readonly cause: AuraCause; readonly match: (item: AuraItem<G>) => boolean },
): number => {
  const from = engine.events.open(removal.cause);
  const removed = strip(engine, bearer, removal.match);

  engine.events.close(from);

  return removed;
};

/** Removes every instance of an aura; true when there was one. */
export const removeAura = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): boolean =>
  removeWhere(engine, bearer, { cause: 'remove', match: (item) => item.id === id }) > 0;

/** Removes every aura granting a tag (a cleanse or dispel); how many went. */
export const removeByTag = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], tag: AuraTagId): number =>
  removeWhere(engine, bearer, {
    cause: 'removeByTag',
    match: (item) => engine.tables.tagBits[item.id]?.has(tag) === true,
  });

/** Removes every aura whose `removedOn` names the state the bearer enters; how many went. */
export const enterState = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  state: G['state'],
): number => {
  const bit = engine.tables.stateNames.indexOf(state);

  if (bit < 0) {
    throw new RangeError(`There is no bearer state ${state}.`);
  }

  return removeWhere(engine, bearer, {
    cause: 'enterState',
    match: (item) => ((engine.tables.removedOn[item.id] ?? 0) & (1 << bit)) !== 0,
  });
};

/** Removes every aura bound to a source that is gone; how many went. */
export const sourceGone = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], source: number): number =>
  removeWhere(engine, bearer, {
    cause: 'sourceGone',
    match: (item) => item.source === source && ((engine.flags[item.id] ?? 0) & BOUND_TO_SOURCE) !== 0,
  });

/** The cleanse of an application: every tag its aura `removes`, tag by tag, each in list order. Dispatches nothing. */
export const cleanse = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): void => {
  for (const tag of engine.tables.removes[id] ?? []) {
    strip(engine, bearer, (item) => engine.tables.tagBits[item.id]?.has(tag) === true);
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
    takeOff(engine, bearer, { index: least, change: REMOVED });
    engine.refreshTags(set);
  }
};

/** Spends stacks from an aura's instances in order; an instance left with none is removed. */
export const spendStacks = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  spend: { readonly id: AuraId; readonly count: number },
): boolean => {
  const set = setOf<G>(bearer);
  let left = spend.count;

  if (!(left > 0)) {
    return true;
  }

  if (heldStacks(set, spend.id) < left) {
    return false;
  }

  const from = engine.events.open('spendStacks');

  for (let i = 0; i < set.items.length && left > 0; i++) {
    const item = set.items[i];

    if (item?.id !== spend.id) {
      continue;
    }

    const taken = Math.min(item.stacks, left);

    item.stacks -= taken;
    left -= taken;
    i -= spendOne(engine, bearer, { index: i, isEmpty: item.stacks <= 0 });
  }

  engine.refreshTags(set);
  engine.events.close(from);

  return true;
};

/** Every stack of an aura held, whatever its `activeWhile` says. */
const heldStacks = <G extends AuraTypes>(set: AuraSet<G>, id: AuraId): number => {
  let stacks = 0;

  for (let i = 0; i < set.items.length; i++) {
    stacks += set.items[i]?.id === id ? (set.items[i]?.stacks ?? 0) : 0;
  }

  return stacks;
};

/** Settles one spent instance: removed when empty, else refreshed. Returns 1 when it left the list. */
const spendOne = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  at: { readonly index: number; readonly isEmpty: boolean },
): number => {
  const set = setOf<G>(bearer);
  const item = set.items[at.index];

  if (at.isEmpty) {
    takeOff(engine, bearer, { index: at.index, change: REMOVED });

    return 1;
  }

  if (item !== undefined) {
    set.changes += 1;
    engine.events.raise(REFRESHED, bearer, item);
  }

  return 0;
};

/**
 * Spends an amount from an aura's value, instance by instance in order (an absorb eating a blow); an instance spent
 * to 0 is removed unless its aura keeps it when depleted. Returns the amount spent.
 */
export const spendValue = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  spend: { readonly id: AuraId; readonly amount: number },
): number => {
  const set = setOf<G>(bearer);
  const from = engine.events.open('spendValue');
  const keeps = ((engine.flags[spend.id] ?? 0) & KEEP_DEPLETED) !== 0;
  let left = spend.amount > 0 ? spend.amount : 0;

  for (let i = 0; i < set.items.length && left > 0; i++) {
    const item = set.items[i];

    if (item?.id !== spend.id || !(item.value > 0)) {
      continue;
    }

    const taken = Math.min(item.value, left);

    item.value -= taken;
    left -= taken;
    i -= spendOne(engine, bearer, { index: i, isEmpty: item.value <= 0 && !keeps });
  }

  engine.refreshTags(set);
  engine.events.close(from);

  return (spend.amount > 0 ? spend.amount : 0) - left;
};

/** Sets the clock of every instance of an aura again (to `seconds`, or its own length); true when there was one. */
export const refreshAura = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  refresh: { readonly id: AuraId; readonly seconds?: number | undefined },
): boolean => {
  const set = setOf<G>(bearer);
  const from = engine.events.open('refresh');
  let found = false;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item?.id === refresh.id) {
      engine.setClock(set, item, refresh.seconds ?? engine.lengthOf(refresh.id, bearer));
      set.changes += 1;
      engine.events.raise(REFRESHED, bearer, item);
      found = true;
    }
  }

  engine.events.close(from);

  return found;
};

/** Raises `bearerDeath` for every aura on a bearer that died, in list order; the auras stay (see `enterState`). */
export const bearerDied = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer']): void => {
  const set = setOf<G>(bearer);
  const from = engine.events.open('bearerDied');

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item !== undefined) {
      engine.events.raise(BEARER_DEATH, bearer, item);
    }
  }

  engine.events.close(from);
};
