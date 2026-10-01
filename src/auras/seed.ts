import type { ActiveAura, AuraItem } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';
import { PREDICTED } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { takeOff } from './remove.ts';
import { type AuraSet, setOf } from './state.ts';
import type { AuraView } from './view.ts';

/**
 * What a prediction mirror is seeded from: a bearer's aura views as the server sent them, and the steps the
 * server's bearer had taken on each clock when they were taken (`AuraState.clocks`), which the views' end stamps count
 * against.
 */
export interface AuraSeed<G extends AuraTypes = AuraTypes> {
  /** The views (`auras.view(bearer, out, { for: 'owner' })` on the server). */
  readonly views: readonly AuraView[];

  /** How many of `views` to seed from, the first; all of them when absent. */
  readonly count?: number;

  /** The server bearer's steps on each clock, by clock id, as the views were taken. */
  readonly clocks: ArrayLike<number>;

  /** The serials the server's bearer had handed out (`AuraState.serials`), which the mirror's count goes on from. */
  readonly serials: number;

  /**
   * Fills a seeded aura's game fields (its `ext`, reset) from what the game sent beside view `index`: a dash's
   * direction its `onLand` kept, which no view carries. Nothing is restored when absent.
   */
  readonly restore?: (aura: ActiveAura<G>, index: number) => void;

  /**
   * Whether a predicted aura's game fields already are what `restore` would fill from view `index`, for `matchesSeed`:
   * a mirror that predicted a wrong direction then differs. Game fields are not compared when absent.
   */
  readonly isRestored?: (aura: ActiveAura<G>, index: number) => boolean;
}

/**
 * Sets a seeded aura's clock from its view by the stamp contract: infinite, or its stamp's distance on the server
 * from the mirror's own count of the clock.
 */
const setSeededClock = <G extends AuraTypes>(
  [set, item, view]: readonly [AuraSet<G>, AuraItem<G>, AuraView],
  serverNow: number
): void => {
  item.duration = view.duration;
  item.end = Number.isFinite(view.end) ? (set.clocks[item.clock] ?? 0) + Math.max(0, view.end - serverNow) : Infinity;
  set.noteEnd(item);
};

/** Puts one predicted aura back on a mirror from its view: a silent state dispatches no beats, so none is due. */
const seedOne = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  [set, view, index]: readonly [AuraSet<G>, AuraView, number],
  seed: AuraSeed<G>
): void => {
  const item = engine.acquire(view.aura);

  item.serial = view.serial;
  item.stacks = view.stacks;
  item.value = view.value;
  item.source = view.source;
  item.nextBeat = Number.POSITIVE_INFINITY;
  setSeededClock([set, item, view], seed.clocks[item.clock] ?? 0);
  engine.insert(set, item);
  seed.restore?.(item, index);
};

/**
 * Seeds a prediction mirror's auras from the wire (`auras.seed`): every `predicted` aura on the bearer is
 * dropped, and every view of a `predicted` aura is put back with its serial, stacks, value, duration and source, its
 * clock set by the stamp contract, and the bearer's serial count set to the server's; the rest of the bearer's auras,
 * and views of auras that are not predicted, are left alone. A silent state dispatches no beats, so a seeded aura has
 * none due. Only a silent state (a mirror's, `createState({ isSilent: true })`) may be seeded, so nothing is raised.
 * Returns how many auras it seeded.
 */
export const seedAuras = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  seed: AuraSeed<G>
): number => {
  const set = setOf<G>(bearer);

  if (!set.isSilent) {
    throw new TypeError('Only a silent aura state (a prediction mirror) may be seeded.');
  }

  const from = engine.events.open('apply');
  let seeded = 0;

  try {
    for (let i = set.items.length - 1; i >= 0; i--) {
      if (((engine.flags[set.items[i]?.id ?? 0] ?? 0) & PREDICTED) !== 0) {
        takeOff(engine, bearer, i);
      }
    }

    for (let i = 0; i < (seed.count ?? seed.views.length); i++) {
      const view = seed.views[i];

      if (view !== undefined && ((engine.flags[view.aura] ?? 0) & PREDICTED) !== 0) {
        seedOne(engine, [set, view, i], seed);
        seeded += 1;
      }
    }

    set.serials = seed.serials;
    engine.refreshTags(set);
    set.changes += 1;
  } finally {
    engine.events.close(from);
  }

  return seeded;
};

/**
 * Whether a mirror's predicted aura is what a view would seed: the same aura, serial, stacks, value, source, duration
 * and end.
 */
const isSeededAs = <G extends AuraTypes>(
  [set, item, view]: readonly [AuraSet<G>, AuraItem<G>, AuraView],
  serverNow: number
): boolean => {
  const end = Number.isFinite(view.end) ? (set.clocks[item.clock] ?? 0) + Math.max(0, view.end - serverNow) : Infinity;

  return (
    item.id === view.aura &&
    item.serial === view.serial &&
    item.stacks === view.stacks &&
    item.value === view.value &&
    item.source === view.source &&
    item.duration === view.duration &&
    item.end === end
  );
};

/** Whether an aura is `predicted`. */
const isPredicted = <G extends AuraTypes>(engine: AuraEngine<G>, aura: number): boolean =>
  ((engine.flags[aura] ?? 0) & PREDICTED) !== 0;

/** The index of the first view of a predicted aura at or after `at`, or `count` for none. */
const nextPredicted = <G extends AuraTypes>(engine: AuraEngine<G>, seed: AuraSeed<G>, at: number): number => {
  const count = seed.count ?? seed.views.length;
  let index = at;

  while (index < count && !isPredicted(engine, seed.views[index]?.aura ?? 0)) {
    index += 1;
  }

  return index;
};

/**
 * Whether a prediction mirror's predicted auras already are what `seedAuras` would make of a seed, game fields too
 * when the seed says how to compare them (a correction that changes nothing): a client compares at each acknowledged step and replays its pending inputs only on a
 * difference, as a seed and a replay otherwise cost every step. Reads only; seeds nothing.
 */
export const matchesSeed = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  seed: AuraSeed<G>
): boolean => {
  const set = setOf<G>(bearer);
  const count = seed.count ?? seed.views.length;
  let at = nextPredicted(engine, seed, 0);

  for (const item of set.items) {
    if (isPredicted(engine, item.id)) {
      const view = at < count ? seed.views[at] : undefined;

      if (
        view === undefined ||
        !isSeededAs([set, item, view], seed.clocks[item.clock] ?? 0) ||
        seed.isRestored?.(item, at) === false
      ) {
        return false;
      }

      at = nextPredicted(engine, seed, at + 1);
    }
  }

  return at >= count && set.serials === seed.serials;
};
