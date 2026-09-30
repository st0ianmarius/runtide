// Hot path: every bearer ticks every tick, so the loops are indexed and nothing is allocated.
/* oxlint-disable typescript/prefer-for-of */
import { isRunOut } from '../core/index.ts';
import type { AuraItem } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';
import { CHANGES } from './compile.ts';
import type { AuraEngine } from './engine.ts';
import { takeOff } from './remove.ts';
import { type AuraSet, setOf } from './state.ts';

/** The change code of `expired`. */
const EXPIRED = CHANGES.indexOf('expired');

/** The period of an aura's beat, read live when it is a function; it must be more than 0. */
const periodOf = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], item: AuraItem<G>): number => {
  const every = engine.registry.defs[item.id]?.periodic?.every ?? 0;

  if (typeof every !== 'function') {
    return every;
  }

  const context = engine.events.take(bearer, item);
  let period = 0;

  try {
    period = every(context);
  } finally {
    engine.events.give();
  }

  if (!(period > 0)) {
    throw new RangeError(`Aura ${engine.registry.name(item.id)}: a live period must be more than 0; got ${period}.`);
  }

  return period;
};

/**
 * Counts down an aura's beat by one step of its clock and queues every beat that came due (catching up when a period
 * is shorter than a step).
 */
const countBeat = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], item: AuraItem<G>): void => {
  const beatClock = engine.tables.beatClock[item.id] ?? 0;
  const clock = engine.tables.clocks[beatClock];
  const { isSilent } = setOf<G>(bearer);
  const periodic = engine.registry.defs[item.id]?.periodic;

  if (clock === undefined || periodic === undefined) {
    return;
  }

  item.nextBeat -= clock.dt;

  while (isRunOut(item.nextBeat)) {
    if (!isSilent) {
      engine.events.beat(bearer, item);
    }

    item.nextBeat += periodOf(engine, bearer, item);
  }
};

/**
 * Takes off every aura that ran out, in list order, each raising `expired`, and sets each clock's due count to the
 * earliest end left on it.
 */
const expire = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer']): void => {
  const set = setOf<G>(bearer);
  let expired = 0;

  set.due.fill(Number.POSITIVE_INFINITY);

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item === undefined) {
      continue;
    }

    if (engine.isDue(set, item)) {
      takeOff(engine, bearer, { index: i, change: EXPIRED });
      i -= 1;
      expired += 1;
    } else {
      set.noteEnd(item);
    }
  }

  if (expired > 0) {
    engine.refreshTags(set);
  }
};

/**
 * Whether a step of `clock` has anything to do on a bearer: an aura beating on it, or a clock whose count reached the
 * earliest end on it. Asked before the step opens its events, so a bearer holding only auras with nothing due (a
 * passive, a long buff) costs a few compares.
 */
const hasWork = <G extends AuraTypes>(set: AuraSet<G>, clock: number): boolean =>
  (set.beats[clock] ?? 0) > 0 || set.isAnyDue();

/**
 * Steps a bearer's clock once: the clock's count rises; in list order the beats counting on it come due, and
 * the beats are dispatched; then every aura that
 * has run out expires, in list order, and those events are dispatched. So a beat due on
 * the tick an aura runs out fires before its expiry.
 */
export const tickAuras = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], clock: number): void => {
  const set = setOf<G>(bearer);
  const { items } = set;

  set.clocks[clock] = (set.clocks[clock] ?? 0) + 1;

  if (!hasWork(set, clock)) {
    return;
  }

  const from = engine.events.open('tick');

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item !== undefined && engine.tables.beatClock[item.id] === clock) {
      countBeat(engine, bearer, item);
    }
  }

  engine.events.finish(from);
  expire(engine, bearer);
  engine.events.close(from);
};
