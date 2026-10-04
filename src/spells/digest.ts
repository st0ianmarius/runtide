import { digest } from '../core/index.ts';
import type { Cast } from './cast.ts';
import { type CasterRecord, recordOf } from './caster.ts';
import type { Delayed } from './delayed.ts';
import type { SpellEngine } from './engine.ts';
import { NO_CAST } from './ids.ts';
import type { SpellTypes } from './spell-types.ts';
import { CAST_STAGES } from './view.ts';

/** What folds for an absent unit, target, stage length or outcome: no entity id or count is ever −1. */
const NONE = -1;

/** The tag a target folds with: none, an id, a point, a unit, anything else. */
const TARGET_NONE = 0;
const TARGET_ID = 1;
const TARGET_POINT = 2;
const TARGET_UNIT = 3;
const TARGET_OTHER = 4;

/** How many interrupt positions a caster may hold: the manual pause's bit 0, then one bit per interrupt. */
const INTERRUPT_POSITIONS = 31;

/** A flag as a number. */
const flag = (isOn: boolean): number => (isOn ? 1 : 0);

/** Whether a value is a unit (an aura bearer: what a cast aims at when it aims at a unit). */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isUnit = <G extends SpellTypes>(value: object): value is G['bearer'] => 'auras' in value;

/** A point's coordinate, or NaN for a value that has none. */
const coordinate = (value: object, axis: 'x' | 'z'): number => {
  const read: unknown = Reflect.get(value, axis);

  return typeof read === 'number' ? read : Number.NaN;
};

/**
 * Folds a cast's target: a tag, then its id (an id, or a unit by the host's `idOf`) or its point (`x`, `z`). A target
 * the spell keeps as anything else folds its tag alone.
 */
const foldTarget = <G extends SpellTypes>(engine: SpellEngine<G>, target: unknown, hash: number): number => {
  if (target === undefined || target === null) {
    return digest(hash, TARGET_NONE);
  }

  if (typeof target === 'number') {
    return digest(digest(hash, TARGET_ID), target);
  }

  if (typeof target !== 'object') {
    return digest(hash, TARGET_OTHER);
  }

  if (isUnit<G>(target)) {
    return digest(digest(hash, TARGET_UNIT), engine.host.idOf?.(target) ?? NONE);
  }

  const x = coordinate(target, 'x');
  const z = coordinate(target, 'z');

  if (Number.isNaN(x) || Number.isNaN(z)) {
    return digest(hash, TARGET_OTHER);
  }

  return digest(digest(digest(hash, TARGET_POINT), x), z);
};

/** Folds a cast's stage, its clocks and its stage lengths as cast. */
const foldStage = <G extends SpellTypes>(cast: Cast<G>, hash: number): number => {
  let next = digest(hash, cast.stage === 'ended' ? NONE : CAST_STAGES.indexOf(cast.stage));

  next = digest(next, cast.stageSeconds);
  next = digest(next, cast.remaining);
  next = digest(next, cast.elapsed);
  next = digest(next, cast.pauses);
  next = digest(next, cast.beat);
  next = digest(next, cast.every);
  next = digest(next, cast.windupSeconds ?? NONE);
  next = digest(next, cast.channelSeconds ?? NONE);

  return digest(next, cast.recoverSeconds ?? NONE);
};

/** Folds a cast's counters and flags: what went off, what it raised, how it ends. */
const foldCounters = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, hash: number): number => {
  let next = digest(hash, cast.went);

  next = digest(next, flag(cast.isLocked));
  next = digest(next, flag(cast.hasReleased));
  next = digest(next, flag(cast.hasRaisedRelease));
  next = digest(next, flag(cast.hasStarted));
  next = digest(next, flag(cast.isCommitted));
  next = digest(next, flag(cast.ignoresCooldown));

  return digest(next, cast.outcome === undefined ? NONE : engine.registry.outcomes.indexOf(cast.outcome));
};

/** Folds one running cast: who and what, when, its target, its stage and its counters. */
const foldCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, hash: number): number => {
  let next = digest(hash, cast.spell);

  next = digest(next, cast.rank);
  next = digest(next, cast.startTick);
  next = digest(next, cast.ordinal);
  next = digest(next, cast.casterId);
  next = digest(next, cast.source);
  next = digest(next, cast.cueKey);
  next = foldTarget(engine, cast.target, next);
  next = foldStage(cast, next);

  return foldCounters(engine, cast, next);
};

/** Folds a caster's armed `auto` clocks, in registry order: each spell, its steps left, its seconds as set and stamp. */
const foldAutos = (record: CasterRecord, hash: number): number => {
  const { autos, steps } = record;
  let next = digest(digest(hash, autos.length), steps);

  for (let i = 0; i < autos.length; i++) {
    next = digest(next, autos[i] ?? NONE);
    next = digest(next, (record.dues[i] ?? 0) - steps);
    next = digest(next, (record.sets[i] ?? 0) - steps);
    next = digest(next, record.lefts[i] ?? 0);
    next = digest(next, record.setTicks[i] ?? Number.NaN);
  }

  return digest(next, record.stampedTick);
};

/** Folds the interrupts a caster holds: their bits, then each held position and how many times it is held. */
const foldInterrupts = (record: CasterRecord, hash: number): number => {
  let next = digest(hash, record.interrupts);

  for (let position = 0; position < INTERRUPT_POSITIONS; position++) {
    const held = record.interruptCounts[position] ?? 0;

    if (held !== 0) {
      next = digest(digest(next, position), held);
    }
  }

  return next;
};

/**
 * Folds a caster's spell state into `hash`: its running casts in start order (each spell, rank, start tick and
 * ordinal, credit, press key, target, stage and its clocks, stage lengths, pauses, beats and counters), the tick
 * ordinal its next cast takes, its `auto` clocks and the interrupts it holds. Allocates nothing.
 */
export const digestCaster = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  hash: number
): number => {
  const record = recordOf(caster);
  let next = digest(hash, record.count);

  for (let i = 0; i < record.count; i++) {
    const cast = engine.castOf(record.handles[i] ?? NO_CAST);

    next = cast === undefined ? digest(next, NONE) : foldCast(engine, cast, next);
  }

  next = digest(digest(next, record.lastTick), record.started);
  next = foldAutos(record, next);

  return foldInterrupts(record, next);
};

/** Whether delayed list `a` lands before `b`: by due tick, then slot, then scheduling order. */
const isBefore = <G extends SpellTypes>(a: Delayed<G>, b: Delayed<G>): boolean => {
  if (a.due !== b.due) {
    return a.due < b.due;
  }

  return a.slot === b.slot ? a.sequence < b.sequence : a.slot < b.slot;
};

/** A unit's entity id by the host's `idOf`, or −1 for none. */
const idOf = <G extends SpellTypes>(engine: SpellEngine<G>, unit: G['bearer'] | undefined): number =>
  unit === undefined ? NONE : (engine.host.idOf?.(unit) ?? NONE);

/** Folds one delayed list: when and where it lands, its owner, its origin, its procs and its cast. */
const foldDelayed = <G extends SpellTypes>(engine: SpellEngine<G>, record: Delayed<G>, hash: number): number => {
  let next = digest(hash, record.due);

  next = digest(next, record.slot);
  next = digest(next, record.anchor);
  next = digest(next, record.offset);
  next = digest(next, idOf(engine, record.owner));
  next = digest(next, idOf(engine, record.self));
  next = digest(next, idOf(engine, record.target));
  next = digest(next, idOf(engine, record.eventUnit));
  next = digest(next, idOf(engine, record.other));
  next = digest(next, record.source);
  next = digest(next, record.procs.length);

  return digest(next, record.cast?.spell ?? NONE);
};

/**
 * Folds every delayed list waiting to land into `hash`, in due order (by due tick, then slot, then the order they were
 * scheduled), each by its due tick, slot, anchor and offset, owner, origin (self, target, event and other unit,
 * credit), proc count and cast's spell; units by the host's `idOf`. The lists are sorted in `order`, a scratch array
 * kept between calls (it grows to the most lists ever waiting, then allocates nothing), and cleared after.
 */
export const digestDelayed = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  order: (Delayed<G> | undefined)[],
  hash: number
): number => {
  const { live } = engine.delayed;
  const count = live.length;

  // An insertion sort in place: the live list is mostly in scheduling order already, and it allocates nothing.
  for (let i = 0; i < count; i++) {
    const record = live[i];
    let at = i;

    while (at > 0 && record !== undefined && isBefore(record, order[at - 1] ?? record)) {
      order[at] = order[at - 1];
      at -= 1;
    }

    order[at] = record;
  }

  let next = digest(hash, count);

  for (let i = 0; i < count; i++) {
    const record = order[i];

    next = record === undefined ? next : foldDelayed(engine, record, next);
    order[i] = undefined;
  }

  return next;
};
