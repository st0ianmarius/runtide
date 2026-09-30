// Seeding walks the bearer's list, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { AuraItem } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';
import { CHANGES } from './compile.ts';
import { PREDICTED } from './define-auras.ts';
import type { AuraEngine } from './engine.ts';
import { takeOff } from './remove.ts';
import { type AuraSet, setOf } from './state.ts';
import type { AuraView } from './view.ts';

/** The change code of `removed`. */
const REMOVED = CHANGES.indexOf('removed');

/**
 * What a prediction mirror is seeded from (§II.6 R3): a bearer's aura views as the server sent them, and the steps the
 * server's bearer had taken on each clock when they were taken (`AuraState.clocks`), which the views' end stamps count
 * against.
 */
export interface AuraSeed {
  /** The views (`auras.view(bearer, { forOwner: true })` on the server). */
  readonly views: readonly AuraView[];

  /** The server bearer's steps on each clock, by clock id, as the views were taken. */
  readonly clocks: ArrayLike<number>;
}

/**
 * Sets a seeded aura's clock from its view by the stamp contract: infinite, or its stamp's distance on the server
 * from the mirror's own count of the clock.
 */
const setSeededClock = <G extends AuraTypes>(
  [set, item, view]: readonly [AuraSet<G>, AuraItem<G>, AuraView],
  serverNow: number,
): void => {
  item.duration = view.duration;
  item.end = Number.isFinite(view.remaining)
    ? (set.clocks[item.clock] ?? 0) + Math.max(0, view.end - serverNow)
    : Infinity;
};

/**
 * Seeds a prediction mirror's auras from the wire (§II.6 R3, `auras.seed`): every `predicted` aura on the bearer is
 * dropped, and every view of a `predicted` aura is put back with its serial, stacks, value, duration and source, its
 * clock set by the stamp contract; the rest of the bearer's auras, and views of auras that are not predicted, are left
 * alone. Only a silent state (a mirror's, `createState({ isSilent: true })`) may be seeded, so nothing is raised.
 * Returns how many auras it seeded.
 */
export const seedAuras = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], seed: AuraSeed): number => {
  const set = setOf<G>(bearer);

  if (!set.isSilent) {
    throw new TypeError('Only a silent aura state (a prediction mirror) may be seeded.');
  }

  const from = engine.events.open('apply');
  let seeded = 0;

  try {
    for (let i = set.items.length - 1; i >= 0; i--) {
      if (((engine.flags[set.items[i]?.id ?? 0] ?? 0) & PREDICTED) !== 0) {
        takeOff(engine, bearer, { index: i, change: REMOVED });
      }
    }

    for (let i = 0; i < seed.views.length; i++) {
      const view = seed.views[i];

      if (view !== undefined && ((engine.flags[view.aura] ?? 0) & PREDICTED) !== 0) {
        const item = engine.acquire(view.aura);

        item.serial = view.serial;
        item.stacks = view.stacks;
        item.value = view.value;
        item.source = view.source;
        setSeededClock([set, item, view], seed.clocks[item.clock] ?? 0);
        engine.insert(set, item);
        seeded += 1;
      }
    }

    engine.refreshTags(set);
    set.changes += 1;
  } finally {
    engine.events.close(from);
  }

  return seeded;
};
