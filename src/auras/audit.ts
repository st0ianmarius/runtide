// Hot path: a digest and a tick count run per bearer per tick, so the loops are indexed and nothing is allocated.
/* oxlint-disable typescript/prefer-for-of */
import { digest } from '../core/digest.ts';
import type { AuraTypes } from './aura-types.ts';
import type { AuraEngine } from './engine.ts';
import { type AuraBearer, type AuraSet, setOf } from './state.ts';

/**
 * A bearer's header: what a server sends beside its aura views so a prediction mirror can seed from them
 * (`auras.headerOf` writes it, `auras.seed` reads it): its steps on each clock, which the views' end stamps count
 * against, and the serials it has handed out, which the mirror's count goes on from.
 */
export interface AuraHeader {
  /** The bearer's steps on each clock, by clock id, as the views were taken: every clock, each a whole number from 0. */
  readonly clocks: ArrayLike<number>;

  /** The serials the bearer had handed out (`AuraState.serials`): a whole number from 0. */
  readonly serials: number;
}

/** What `auras.headerOf` fills: a reused header, its `clocks` a number array or a typed array of every clock. */
export interface AuraHeaderBuffer {
  /** Written from index 0 with the bearer's steps on each clock. */
  readonly clocks: number[] | Float64Array;

  /** Set to the bearer's serial count. */
  serials: number;
}

/** The tick a clock reports, read live; 0 for a clock that reports none. */
const tickOf = <G extends AuraTypes>(engine: AuraEngine<G>, clock: number): number =>
  engine.tables.clocks[clock]?.tick ?? 0;

/** Counts one step of a bearer's clock against the clock's current tick: a step on a new tick starts the count at 1. */
export const countTick = <G extends AuraTypes>(engine: AuraEngine<G>, set: AuraSet<G>, clock: number): void => {
  const now = tickOf(engine, clock);

  if (set.tickStamps[clock] === now) {
    set.tickCounts[clock] = (set.tickCounts[clock] ?? 0) + 1;
  } else {
    set.tickStamps[clock] = now;
    set.tickCounts[clock] = 1;
  }
};

/** How many times a bearer was stepped on a clock on the clock's current tick; 0 when it was not this tick. */
export const tickCountOf = <G extends AuraTypes>(engine: AuraEngine<G>, bearer: G['bearer'], clock: number): number => {
  const set = setOf<G>(bearer);

  return set.tickStamps[clock] === tickOf(engine, clock) ? (set.tickCounts[clock] ?? 0) : 0;
};

/**
 * Folds a bearer's whole aura state into `hash` (`digest`), in a fixed order: its steps on each clock, its serial
 * count, whether it was released, how many auras it holds, then each aura in list order (its id, source, stacks,
 * value, duration, end stamp, clock, serial and time to its next beat). Its tags are left out, being derived from its
 * auras, and so is each aura's `ext`, which is opaque to the framework: a game folds what of it matters itself.
 */
export const digestAuras = (bearer: AuraBearer, hash: number): number => {
  const set = setOf<AuraTypes>(bearer);
  const { items, clocks } = set;
  let next = hash;

  for (let clock = 0; clock < clocks.length; clock++) {
    next = digest(next, clocks[clock] ?? 0);
  }

  next = digest(digest(digest(next, set.serials), set.isReleased ? 1 : 0), items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item === undefined) {
      continue;
    }

    next = digest(digest(digest(digest(next, item.id), item.source), item.stacks), item.value);
    next = digest(digest(digest(digest(next, item.duration), item.end), item.clock), item.serial);
    next = digest(next, item.nextBeat);
  }

  return next;
};

/** Writes a bearer's header into `out` (every clock's steps from index 0, and its serial count); returns `out`. */
export const writeHeader = <Out extends AuraHeaderBuffer>(bearer: AuraBearer, out: Out): Out => {
  const { clocks, serials } = setOf<AuraTypes>(bearer);

  for (let clock = 0; clock < clocks.length; clock++) {
    out.clocks[clock] = clocks[clock] ?? 0;
  }

  if (out.clocks.length < clocks.length) {
    throw new RangeError(`An aura header needs room for ${clocks.length} clocks; it has ${out.clocks.length}.`);
  }

  out.serials = serials;

  return out;
};
