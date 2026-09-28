import { isRunOut } from '../core/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaPulse } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';
import { catchIn, deliver, type Hit, recordHit } from './hits.ts';

/** No pulses. */
const NO_PULSES: readonly never[] = Object.freeze([]);

/** A clock shared by several area triggers (§II.6 W2): its owner's instances of a kind, or all of the kind. */
export class SharedClock {
  /** The seconds to its next beat. */
  remaining = 0;

  /** How many live members it has. */
  members = 0;

  /** Whether it has started: false before its first member, and again once empty for a clock that resets. */
  isStarted = false;

  /** The tick it last counted down on, so it counts once per tick whoever steps first. */
  steppedTick = -1;
}

/** The seconds between a pulse's beats, read from its area trigger for a function. */
const secondsOf = <G extends AreaTriggerTypes>(pulse: AreaPulse<G>, area: AreaTrigger<G>): number => {
  const seconds = typeof pulse.seconds === 'function' ? pulse.seconds(area) : pulse.seconds;

  if (!(Number.isFinite(seconds) && seconds > 0)) {
    throw new RangeError(`A pulse beats every finite number of seconds above 0; got ${seconds}.`);
  }

  return seconds;
};

/** The clock a shared pulse of an area trigger beats on, made on first use. */
const sharedClockOf = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  index: number,
): SharedClock => {
  const slot = (engine.pulseBase[area.kind] ?? 0) + index;
  const pulse = engine.registry.get(area.kind).every?.[index];
  const clocks = pulse?.clock === 'global' ? engine.globalClocks : engine.ownerClocks(area.owner);

  return (clocks[slot] ??= new SharedClock());
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

/** Whether an area trigger takes part in a shared beat: live, running, armed, and not spawned this tick. */
const isMember = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, owner: unknown): boolean =>
  !area.isEnding &&
  !area.isSuspended &&
  area.arming <= 0 &&
  area.spawnTick < engine.clock.tick &&
  (owner === undefined || area.owner === owner);

/** What every member of a shared beat caught: each unit, the heat of the member that caught it, and that member. */
interface Caught<Unit> {
  /** The units, member by member. */
  readonly units: Unit[];

  /** The heat of the member that caught each. */
  readonly heats: number[];

  /** The index of the member that caught each. */
  readonly of: number[];
}

/** Whether the `i`-th caught entry is the hottest catch of its unit (the first of the hottest on ties). */
const isHottest = <Unit>(caught: Caught<Unit>, i: number): boolean => {
  const unit = caught.units[i];
  const heat = caught.heats[i] ?? 0;

  for (let j = 0; j < caught.units.length; j++) {
    const other = caught.heats[j] ?? 0;

    if (j !== i && caught.units[j] === unit && (other > heat || (other === heat && j < i))) {
      return false;
    }
  }

  return true;
};

/** A shared beat's members and what they caught. */
interface Beat<G extends AreaTriggerTypes> {
  /** The members, in creation order. */
  readonly members: AreaTrigger<G>[];

  /** What they caught. */
  readonly caught: Caught<G['bearer']>;

  /** The pulse beating. */
  readonly index: number;
}

/** Catches what one member of a shared beat catches, noting its heat and its place among the members. */
const catchMember = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, member: AreaTrigger<G>, beat: Beat<G>) => {
  const index = beat.index;
  const pulse = engine.registry.get(member.kind).every?.[index];
  const heat = pulse?.heat?.(member) ?? member.remaining;
  const hit = engine.catcher.take(member, pulse, undefined);

  try {
    catchPulse(engine, hit, index);

    for (const unit of hit.targets) {
      beat.caught.units.push(unit);
      beat.caught.heats.push(heat);
      beat.caught.of.push(beat.members.length);
    }
  } finally {
    engine.catcher.give(hit);
  }
};

/** Hands one member of a shared beat what it kept: all it caught, or with `hottest` the units it was hottest for. */
const deliverMember = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, member: AreaTrigger<G>, beat: Beat<G>) => {
  const { caught, index } = beat;
  const m = beat.members.indexOf(member);
  const pulse = engine.registry.get(member.kind).every?.[index];
  const isHot = pulse?.pick === 'hottest';
  const hit = engine.catcher.take(member, pulse, pulse?.onPulse);
  let count = 0;

  hit.pulse = index;

  try {
    for (let i = 0; i < caught.units.length; i++) {
      const unit = caught.units[i];

      if (unit !== undefined && caught.of[i] === m && (!isHot || isHottest(caught, i))) {
        hit.units[count] = unit;
        count += 1;
      }
    }

    hit.fill(count);
    recordHit(engine, hit);
    deliver(engine, hit);
  } finally {
    engine.catcher.give(hit);
  }
};

/**
 * One shared beat (§II.6 W2, §II.3.4's `hottest-per-owner-clock`): every member (judged now, in creation order) catches
 * its units; with `hottest`, a unit several members caught goes only to the hottest of them; then each member's
 * `onPulse` runs with what it kept.
 */
const sharedBeat = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, first: AreaTrigger<G>, index: number): void => {
  const pulse = engine.registry.get(first.kind).every?.[index];
  const owner = pulse?.clock === 'global' ? undefined : first.owner;
  const beat: Beat<G> = { members: [], caught: { units: [], heats: [], of: [] }, index };

  for (let walk = engine.kindHeads[first.kind]; walk !== undefined; walk = walk.kindNext) {
    if (isMember(engine, walk, owner)) {
      catchMember(engine, walk, beat);
      beat.members.push(walk);
    }
  }

  for (const member of beat.members) {
    if (!member.isEnding) {
      deliverMember(engine, member, beat);
    }
  }
};

/**
 * The time to a pulse's next beat after one that fired with `left` to spare (0 or below): the previous due time plus
 * its seconds (`cadence`, the leftover carried), or its seconds (`restart`).
 */
const rescheduled = <G extends AreaTriggerTypes>(pulse: AreaPulse<G>, area: AreaTrigger<G>, left: number): number =>
  pulse.reschedule === 'restart' ? secondsOf(pulse, area) : left + secondsOf(pulse, area);

/** Runs an own-clock pulse's beats due after counting `dt` down; they catch up unless told not to. */
const ownBeats = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, index: number): void => {
  const pulse = engine.registry.get(area.kind).every?.[index];
  const rule = engine.clock.countdown;
  let fired = 0;

  while (pulse !== undefined && isRunOut(area.beats[index] ?? 0, rule) && !area.isEnding) {
    if (fired > 0 && pulse.catchUp === false) {
      area.beats[index] = secondsOf(pulse, area);

      return;
    }

    beat(engine, area, index);
    fired += 1;
    area.beats[index] = rescheduled(pulse, area, area.beats[index] ?? 0);
  }
};

/** Runs a shared clock's beats due after counting `dt` down, from the member stepping it. */
const sharedBeats = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, index: number): void => {
  const pulse = engine.registry.get(area.kind).every?.[index];
  const clock = sharedClockOf(engine, area, index);
  const rule = engine.clock.countdown;
  let fired = 0;

  while (pulse !== undefined && isRunOut(clock.remaining, rule) && !area.isEnding) {
    if (fired > 0 && pulse.catchUp === false) {
      clock.remaining = secondsOf(pulse, area);

      return;
    }

    sharedBeat(engine, area, index);
    fired += 1;
    clock.remaining = rescheduled(pulse, area, clock.remaining);
  }
};

/**
 * Runs an area trigger's pulses for a frame of `dt` (§II.6 W2), in their order: an own clock counts down and beats;
 * a shared clock counts down once per tick, from its first member to step, and beats every member at once.
 */
export const stepPulses = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  dt: number,
): void => {
  const pulses = engine.registry.get(area.kind).every ?? NO_PULSES;

  for (let index = 0; index < pulses.length && !area.isEnding; index++) {
    const pulse = pulses[index];

    if (pulse === undefined || (pulse.clock ?? 'own') === 'own') {
      area.beats[index] = (area.beats[index] ?? 0) - dt;
      ownBeats(engine, area, index);

      continue;
    }

    const clock = sharedClockOf(engine, area, index);

    if (clock.steppedTick !== engine.clock.tick) {
      clock.steppedTick = engine.clock.tick;
      clock.remaining -= dt;
      sharedBeats(engine, area, index);
    }
  }
};

/** Sets an area trigger's pulse clocks as it spawns: its own clocks to their first beat, and joins its shared ones. */
export const joinPulses = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const pulses = engine.registry.get(area.kind).every ?? [];

  area.beats.length = pulses.length;

  for (const [index, pulse] of pulses.entries()) {
    const first = pulse.first ?? secondsOf(pulse, area);

    if ((pulse.clock ?? 'own') === 'own') {
      area.beats[index] = first;
      continue;
    }

    const clock = sharedClockOf(engine, area, index);

    clock.members += 1;

    if (!clock.isStarted) {
      clock.isStarted = true;
      clock.remaining = first;
      clock.steppedTick = engine.clock.tick;
    }
  }
};

/** Takes an area trigger off its shared clocks as it ends; an emptied clock that resets starts again with the next. */
export const leavePulses = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const pulses = engine.registry.get(area.kind).every ?? [];

  for (const [index, pulse] of pulses.entries()) {
    if ((pulse.clock ?? 'own') === 'own') {
      continue;
    }

    const clock = sharedClockOf(engine, area, index);

    clock.members -= 1;

    if (clock.members <= 0 && pulse.whenEmpty !== 'survive') {
      clock.isStarted = false;
    }
  }
};
