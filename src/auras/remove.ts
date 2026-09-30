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

/** The code of the `independent` stacking rule. */
const INDEPENDENT = STACKINGS.indexOf('independent');

/**
 * Takes the aura at `index` off its bearer's list, shifting the rest down (no array is made). The last slot goes with
 * `pop`, never by setting the length: a length set to 0 drops the list's storage, and the bearer's next aura would
 * allocate it again, where `pop` keeps a small list's storage.
 */
const cut = <G extends AuraTypes>(engine: AuraEngine<G>, set: AuraSet<G>, index: number): void => {
  const beatClock = engine.tables.beatClock[set.items[index]?.id ?? 0] ?? -1;

  if (beatClock >= 0) {
    set.beats[beatClock] = (set.beats[beatClock] ?? 0) - 1;
  }

  set.items.copyWithin(index, index + 1);
  set.items.pop();
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

  cut(engine, set, at.index);
  set.changes += 1;
  engine.events.retire(item);
  engine.events.raise(at.change, bearer, item);
};

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

/** A removal: which auras it takes, with its argument. */
interface Removal<G extends AuraTypes> {
  /** The matcher. */
  readonly match: Match<G>;

  /** Its argument. */
  readonly arg: number;
}

/** Removes every aura `match` accepts, in list order, each raising `removed`; how many went. Dispatches nothing. */
const strip = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], removal: Removal<G>): number => {
  const set = setOf<G>(bearer);
  let removed = 0;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item !== undefined && removal.match(engine, item, removal.arg)) {
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

/** Runs a removal as one operation with its cause (and its remover): strips, then dispatches its events. */
const removeWhere = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  removal: Removal<G> & { readonly cause: AuraCause; readonly remover?: number },
): number => {
  const from = engine.events.open(removal.cause, removal.remover);
  const removed = strip(engine, bearer, removal);

  engine.events.close(from);

  return removed;
};

/** Removes every instance of an aura; true when there was one. */
export const removeAura = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): boolean =>
  removeWhere(engine, bearer, { cause: 'remove', match: byId, arg: id }) > 0;

/** Removes every aura granting a tag (a cleanse or dispel); how many went. */
export const removeByTag = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], tag: AuraTagId): number =>
  removeWhere(engine, bearer, { cause: 'removeByTag', match: byTag, arg: tag });

/**
 * A bearer enters a state: every aura on it hears `stateEntered` (its `onState`), in list order and dispatched first,
 * then every aura whose `removedOn` names the state goes; how many went.
 */
export const enterState = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  state: G['state'],
): number => {
  const bit = engine.tables.stateNames.indexOf(state);

  if (bit < 0) {
    throw new RangeError(`There is no bearer state ${state}.`);
  }

  const set = setOf<G>(bearer);
  const from = engine.events.open('enterState');

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item !== undefined) {
      engine.events.raiseState(bearer, item, bit);
    }
  }

  engine.events.close(from);

  return removeWhere(engine, bearer, { cause: 'enterState', match: byState, arg: bit });
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
      engine.events.retire(item);
    }
  }

  if (count > 0) {
    set.changes += 1;
    set.beats.fill(0);
    set.due.fill(Number.POSITIVE_INFINITY);
    engine.refreshTags(set);
  }

  engine.events.close(from);

  return count;
};

/** Removes every aura bound to a source that is gone; how many went. */
export const sourceGone = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], source: number): number =>
  removeWhere(engine, bearer, { cause: 'sourceGone', match: bySource, arg: source });

/** The cleanse of an application: every tag its aura `removes`, tag by tag, each in list order. Dispatches nothing. */
export const cleanse = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], id: AuraId): void => {
  const tags = engine.tables.removes[id];

  if (tags === undefined) {
    return;
  }

  for (let i = 0; i < tags.length; i++) {
    strip(engine, bearer, { match: byTag, arg: tags[i] ?? -1 });
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

/** Every stack of an aura held, summed over its instances. */
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
 * Spends an amount from an aura's value, instance by instance in order (an absorb eating a blow), or from one instance
 * alone when `only` names it (the instance whose hook absorbed); an instance spent to 0 is removed unless its aura
 * keeps it when depleted. Returns the amount spent.
 */
export const spendValue = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  spend: { readonly id: AuraId; readonly amount: number; readonly only?: ActiveAura | undefined },
): number => {
  const set = setOf<G>(bearer);
  const from = engine.events.open('spendValue');
  const keeps = ((engine.flags[spend.id] ?? 0) & KEEP_DEPLETED) !== 0;
  let left = spend.amount > 0 ? spend.amount : 0;

  for (let i = 0; i < set.items.length && left > 0; i++) {
    const item = set.items[i];

    if (item?.id !== spend.id || !(item.value > 0) || (spend.only !== undefined && item !== spend.only)) {
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
