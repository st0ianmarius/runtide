// Hot path: every bearer ticks every tick, so the loops are indexed and nothing is allocated.
/* oxlint-disable typescript/prefer-for-of */
import { isRunOut } from '../core/index.ts';
import type { AuraItem } from './active-aura.ts';
import { MIN_PERIOD } from './aura-def.ts';
import type { AuraTypes } from './aura-types.ts';
import type { AuraEngine } from './engine.ts';
import { expireAt } from './remove.ts';
import { type AuraSet, setOf } from './state.ts';

/** The period of an aura's beat (its first one too), read live when it is a function; at least `MIN_PERIOD`. */
export const periodOf = <G extends AuraTypes>(
  engine: AuraEngine<G>,
  bearer: G['bearer'],
  item: AuraItem<G>
): number => {
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

  if (!(period >= MIN_PERIOD)) {
    throw new RangeError(
      `Aura ${engine.registry.name(item.id)}: a live period must be seconds from ${MIN_PERIOD}; got ${period}.`
    );
  }

  return period;
};

/**
 * Counts down an aura's beat by one step of its beat clock and queues the beats that came due: every one (catching up
 * when a period is shorter than a step), or with `catchUp: false` one, the beat restarting at the period. A silent
 * bearer (a prediction mirror) neither beats nor reads a live period, which may read state only the server holds.
 */
const countBeat = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], item: AuraItem<G>): void => {
  const beatClock = engine.tables.beatClock[item.id] ?? 0;
  const clock = engine.tables.clocks[beatClock];
  const periodic = engine.registry.defs[item.id]?.periodic;

  if (clock === undefined || periodic === undefined || setOf<G>(bearer).isSilent) {
    return;
  }

  item.nextBeat -= clock.dt;

  if (periodic.catchUp === false) {
    if (isRunOut(item.nextBeat)) {
      engine.events.beat(bearer, item);
      item.nextBeat = periodOf(engine, bearer, item);
    }

    return;
  }

  while (isRunOut(item.nextBeat)) {
    engine.events.beat(bearer, item);
    item.nextBeat += periodOf(engine, bearer, item);
  }
};

/**
 * Takes off every aura on `clock` that ran out, in list order, each raising `expired`, and sets the clock's due count
 * to the earliest end left on it. An aura on another clock waits for a tick of its own, so a server and a prediction
 * mirror ticking different clocks between acks expire it on the same one; their due counts stay as they were, still at
 * or below their earliest ends (an aura taken off only leaves one low, made exact again by that clock's next walk).
 */
const expire = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], clock: number): void => {
  const set = setOf<G>(bearer);
  let expired = 0;

  set.due[clock] = Number.POSITIVE_INFINITY;

  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];

    if (item?.clock !== clock) {
      continue;
    }

    if (engine.isDue(set, item)) {
      expireAt(engine, bearer, i);
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
 * Whether a step of `clock` has anything to do on a bearer: an aura beating on it (none on a silent bearer, which
 * never beats), or its count reaching the earliest end on it. Asked before the step opens its events, so a bearer
 * holding only auras with nothing due (a passive, a long buff) costs a few compares.
 */
const hasWork = <G extends AuraTypes>(set: AuraSet<G>, clock: number): boolean =>
  (!set.isSilent && (set.beats[clock] ?? 0) > 0) || set.isDueOn(clock);

/**
 * Steps a bearer's clock once: the clock's count rises; in list order the beats counting on it come due, and the
 * beats are dispatched; then every aura on that clock that has run out expires, in list order, and those events are
 * dispatched. So a beat due on the tick an aura runs out fires before its expiry, and an aura on another clock (one
 * at 0 left included) waits for a tick of its own.
 */
export const tickAuras = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], clock: number): void => {
  const set = setOf<G>(bearer);
  const { items } = set;

  set.clocks[clock] = (set.clocks[clock] ?? 0) + 1;

  if (!hasWork(set, clock)) {
    return;
  }

  const from = engine.events.open('tick');

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item !== undefined && engine.tables.beatClock[item.id] === clock) {
        countBeat(engine, bearer, item);
      }
    }

    engine.events.finish(from);
    expire(engine, bearer, clock);
  } finally {
    engine.events.close(from);
  }
};
