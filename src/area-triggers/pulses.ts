import { isRunOut } from '../core/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaPulse } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';
import { catchIn, deliver, type Hit, recordHit } from './hits.ts';

/** No pulses. */
const NO_PULSES: readonly never[] = Object.freeze([]);

/** The seconds between a pulse's beats, read from its area trigger for a function. */
const secondsOf = <G extends AreaTriggerTypes>(pulse: AreaPulse<G>, area: AreaTrigger<G>): number => {
  const seconds = typeof pulse.seconds === 'function' ? pulse.seconds(area) : pulse.seconds;

  if (!(Number.isFinite(seconds) && seconds > 0)) {
    throw new RangeError(`A pulse beats every finite number of seconds above 0; got ${seconds}.`);
  }

  return seconds;
};

/** Catches a pulse's units for its hit's area trigger: its placed shape, a shape of its own, or none. */
const catchPulse = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, hit: Hit<G>, index: number): number => {
  const { area } = hit;
  const pulse = area === undefined ? undefined : engine.registry.get(area.kind).every?.[index];

  hit.pulse = index;

  if (area === undefined || pulse === undefined || pulse.hits === 'none') {
    return 0;
  }

  const shape =
    pulse.hits === undefined ? area.shape : area.placerFor(index).place(pulse.hits, area.position, area.heading);

  return catchIn(engine, hit, shape);
};

/** Whether an area trigger still runs its frame: not ending, and not asked to end (`c.despawn`, spent). */
const isRunning = <G extends AreaTriggerTypes>(area: AreaTrigger<G>): boolean =>
  !area.isEnding && area.pending === undefined;

/** One beat of a pulse for one area trigger: what it catches, recorded in its ledger and handed to `onPulse`. */
const beat = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, index: number): void => {
  const pulse = engine.registry.get(area.kind).every?.[index];
  const hit = engine.catcher.take(area, pulse, pulse?.onPulse);

  try {
    catchPulse(engine, hit, index);
    recordHit(engine, hit);
    deliver(engine, hit);
  } finally {
    engine.catcher.give(hit);
  }
};

/**
 * The time to a pulse's next beat after one that fired with `left` to spare (0 or below): the previous due time plus
 * its seconds (`cadence`, the leftover carried), or its seconds (`restart`).
 */
const rescheduled = <G extends AreaTriggerTypes>(pulse: AreaPulse<G>, area: AreaTrigger<G>, left: number): number =>
  pulse.reschedule === 'restart' ? secondsOf(pulse, area) : left + secondsOf(pulse, area);

/** Runs a pulse's beats due after counting `dt` down; they catch up unless told not to. */
const ownBeats = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, index: number): void => {
  const pulse = engine.registry.get(area.kind).every?.[index];
  let fired = 0;

  while (pulse !== undefined && isRunOut(area.beats[index] ?? 0) && isRunning(area)) {
    if (fired > 0 && pulse.catchUp === false) {
      area.beats[index] = secondsOf(pulse, area);

      return;
    }

    beat(engine, area, index);
    fired += 1;
    area.beats[index] = rescheduled(pulse, area, area.beats[index] ?? 0);
  }
};

/** Runs an area trigger's pulses for a frame of `dt`, in their order: each clock counts down and beats. */
export const stepPulses = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  dt: number
): void => {
  const pulses = engine.registry.get(area.kind).every ?? NO_PULSES;

  for (let index = 0; index < pulses.length && isRunning(area); index++) {
    area.beats[index] = (area.beats[index] ?? 0) - dt;
    ownBeats(engine, area, index);
  }
};

/** Sets an area trigger's pulse clocks to their first beat as it spawns. */
export const joinPulses = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const pulses = engine.registry.get(area.kind).every ?? [];

  for (const [index, pulse] of pulses.entries()) {
    area.beats[index] = pulse.first ?? secondsOf(pulse, area);
  }
};
