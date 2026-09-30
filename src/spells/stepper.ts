import { countDown, isRunOut } from '../core/index.ts';
import type { Cast } from './cast.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import { afterPayload, endCast, isEnded, releaseCast } from './runner.ts';
import type { CastOutcome } from './spell-def.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import { refreshLive } from './take-stats.ts';

/** The pause bit `spells.pause` sets; each interrupt that pauses has a bit of its own above it. */
export const MANUAL_PAUSE = 1;

/** Counts a cast's stage down by one step; true when it ran out. */
const countStage = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): boolean => {
  const { dt } = engine.clock;

  cast.remaining = countDown(cast.remaining, dt);
  cast.elapsed = cast.stageSeconds - cast.remaining;

  return isRunOut(cast.remaining);
};

/**
 * One windup step: the clock counts down, the aim tracks until it locks (the new target, or `'lock'`), `cancelIf`
 * may cancel it, and a windup that ran out releases.
 */
const stepWindup = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const isOut = countStage(engine, cast);
  const { timeline } = engine.registry.get(cast.spell);
  const track = engine.plans[cast.spell]?.track;

  if (!cast.isLocked && track !== undefined) {
    const aim = track(cast, cast.target);

    if (aim === 'lock') {
      cast.isLocked = true;
    } else {
      cast.target = aim;
    }
  }

  if (timeline?.windup?.cancelIf?.(cast, cast.target) === true) {
    endCast(engine, cast, 'cancelled');

    return;
  }

  if (isOut) {
    releaseCast(engine, cast);
  }
};

/** Runs one channel beat: its cue, then its procs. */
const beat = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const def = engine.registry.get(cast.spell);
  const tick = def.timeline?.channel?.tick;

  engine.fire(cast, def.cues?.tick?.(cast, cast.target));

  if (tick === undefined) {
    return;
  }

  const list = engine.takeList();

  try {
    engine.run(cast, tick(cast, cast.target, list), list);
  } finally {
    engine.giveList(list);
  }
};

/**
 * One channel step: `breakIf` may break it (then its recovery), the clock counts down, the beats due run (several when
 * a beat is shorter than the step, the leftover carried; every step when it has none; the last on its last step), and
 * a channel that ran out ends its payload as released.
 */
const stepChannel = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  if (engine.registry.get(cast.spell).timeline?.channel?.breakIf?.(cast, cast.target) === true) {
    afterPayload(engine, cast, 'broken');

    return;
  }

  const isOut = countStage(engine, cast);
  const every = engine.plans[cast.spell]?.every ?? 0;

  if (every > 0) {
    cast.beat -= engine.clock.dt;

    while (isRunOut(cast.beat) && !isEnded(cast)) {
      beat(engine, cast);
      cast.beat += every;
    }
  } else {
    beat(engine, cast);
  }

  if (isOut && cast.stage === 'channel') {
    afterPayload(engine, cast, 'released');
  }
};

/** Steps one cast by one step of its stage; a paused cast does not count. */
const stepCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  if (cast.pauses !== 0) {
    return;
  }

  refreshLive(engine, cast, engine.registry.get(cast.spell));

  switch (cast.stage) {
    case 'windup': {
      stepWindup(engine, cast);
      break;
    }

    case 'channel': {
      stepChannel(engine, cast);
      break;
    }

    case 'recover': {
      if (countStage(engine, cast)) {
        endCast(engine, cast, cast.outcome ?? 'released');
      }

      break;
    }

    case 'ended': {
      break;
    }
  }
};

/**
 * Copies a caster's running casts into the engine's handle list of the next nesting level and returns it with the
 * count, so a walk over them is not shifted by casts that end or start during it. Give it back with `giveHandles`.
 */
const snapshot = <G extends SpellTypes>(engine: SpellEngine<G>, caster: G['bearer']): CastHandle[] => {
  const record = recordOf(caster);
  const handles = engine.takeHandles();

  for (let i = 0; i < record.count; i++) {
    handles[i] = record.handles[i] ?? NO_CAST;
  }

  return handles;
};

/**
 * Steps every cast a caster runs by one step of the clock, in the order they started (§II.3.3, stepped per caster so the
 * game keeps its own per-unit order; pausing is not counting down). A cast started during the step waits for the next.
 */
export const stepCaster = <G extends SpellTypes>(engine: SpellEngine<G>, caster: G['bearer']): void => {
  const count = recordOf(caster).count;

  if (count === 0) {
    return;
  }

  const handles = snapshot(engine, caster);

  try {
    for (let i = 0; i < count; i++) {
      const cast = engine.castOf(handles[i] ?? NO_CAST);

      if (cast !== undefined && !isEnded(cast)) {
        cast.holds += 1;
        stepCast(engine, cast);
        engine.unhold(cast);
      }
    }
  } finally {
    engine.giveHandles(handles, count);
  }
};

/** A running cast behind a handle, or `undefined` for a stale or ended one. */
const running = <G extends SpellTypes>(engine: SpellEngine<G>, handle: CastHandle): Cast<G> | undefined => {
  const cast = engine.castOf(handle);

  return cast === undefined || isEnded(cast) ? undefined : cast;
};

/** Sets or clears pause bits on a running cast; false for a stale or ended one. */
export const setPause = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  handle: CastHandle,
  change: { readonly bits: number; readonly isOn: boolean },
): boolean => {
  const cast = running(engine, handle);

  if (cast === undefined) {
    return false;
  }

  cast.pauses = change.isOn ? cast.pauses | change.bits : cast.pauses & ~change.bits;

  return true;
};

/** Cancels a running cast (§II.3.3): `onCancel`, then its end; false for a stale or ended one. */
export const cancelCast = <G extends SpellTypes>(engine: SpellEngine<G>, handle: CastHandle): boolean => {
  const cast = running(engine, handle);

  if (cast === undefined) {
    return false;
  }

  endCast(engine, cast, 'cancelled');

  return true;
};

/**
 * Ends a running cast's payload now with an outcome (§II.3.3: a charge into a wall ends `blocked`): a windup does not
 * release, a channel stops, and its recovery follows (read with the outcome known); false for a stale or ended one, or
 * for one already recovering.
 */
export const finishCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  handle: CastHandle,
  outcome: Exclude<CastOutcome<G>, 'cancelled'>,
): boolean => {
  if (outcome === 'cancelled' || !engine.registry.outcomes.includes(outcome)) {
    throw new RangeError(
      `A cast cannot finish as ${outcome}: name the game's outcomes in the spell registry's outcomes.`,
    );
  }

  const cast = running(engine, handle);

  if (cast === undefined || cast.stage === 'recover') {
    return false;
  }

  cast.holds += 1;
  afterPayload(engine, cast, outcome);
  engine.unhold(cast);

  return true;
};

/** How one cast answers an interrupt: 1 when it paused, resumed or was cancelled, else 0. */
const answer = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  handle: CastHandle,
  change: { readonly reason: G['interrupt']; readonly isOn: boolean; readonly bits: number },
): number => {
  const cast = running(engine, handle);
  const answers = cast === undefined ? undefined : engine.registry.get(cast.spell).timeline?.interrupts;
  const reply = answers?.[change.reason];

  if (reply === 'cancel' && change.isOn) {
    return cancelCast(engine, handle) ? 1 : 0;
  }

  return reply === 'pause' && setPause(engine, handle, { bits: change.bits, isOn: change.isOn }) ? 1 : 0;
};

/**
 * Raises (or ends) an interrupt on a caster (§II.3.3, F16): the caster holds it until it ends (`isInterrupted`), and
 * each running cast answers it as its timeline says, `pause` (its stage stops counting until the interrupt ends) or
 * `cancel`; a cast whose timeline does not name it runs on. Returns how many casts answered.
 */
export const interruptCaster = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  change: { readonly reason: G['interrupt']; readonly isOn: boolean },
): number => {
  const record = recordOf(caster);
  const { count } = record;
  const bits = engine.interruptBits.get(change.reason) ?? 0;

  record.interrupts = change.isOn ? record.interrupts | bits : record.interrupts & ~bits;

  if (count === 0 || bits === 0) {
    return 0;
  }

  const handles = snapshot(engine, caster);
  let answered = 0;

  try {
    for (let i = 0; i < count; i++) {
      answered += answer(engine, handles[i] ?? NO_CAST, { reason: change.reason, isOn: change.isOn, bits });
    }
  } finally {
    engine.giveHandles(handles, count);
  }

  return answered;
};

/** Cancels every cast a caster runs (§I.7.1 F16: its death), in the order they started; how many it cancelled. */
export const cancelCaster = <G extends SpellTypes>(engine: SpellEngine<G>, caster: G['bearer']): number => {
  const { count } = recordOf(caster);

  if (count === 0) {
    return 0;
  }

  const handles = snapshot(engine, caster);
  let cancelled = 0;

  try {
    for (let i = 0; i < count; i++) {
      cancelled += cancelCast(engine, handles[i] ?? NO_CAST) ? 1 : 0;
    }
  } finally {
    engine.giveHandles(handles, count);
  }

  return cancelled;
};

/** Whether a caster runs any cast, or a cast of one spell. */
export const isCasting = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  spell: SpellId | undefined,
): boolean => {
  const record = recordOf(caster);

  if (spell === undefined) {
    return record.count > 0;
  }

  for (let i = 0; i < record.count; i++) {
    if (engine.castOf(record.handles[i] ?? NO_CAST)?.spell === spell) {
      return true;
    }
  }

  return false;
};

/** An interrupt with no bit: neither declared by the game nor named by a timeline. */
const unknownInterrupt = (reason: string): never => {
  throw new RangeError(`Interrupt ${reason} is not one the spell system knows: declare it in its interrupts.`);
};

/** The pause bits of interrupts, or'd together; throws for one the system does not know. */
export const interruptMaskOf = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  reasons: readonly G['interrupt'][],
): number => reasons.reduce((mask, reason) => mask | (engine.interruptBits.get(reason) ?? unknownInterrupt(reason)), 0);

/** Holds a cast's record past its end (§I.7.1 F18: a summon kept its cast); false for a cast that is gone. */
export const holdCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: CastHandle): boolean => {
  const record = engine.castOf(cast);

  if (record === undefined) {
    return false;
  }

  record.holds += 1;

  return true;
};

/** Lets go of one hold on a cast's record, which is freed once it has ended and nothing holds it. */
export const unholdCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: CastHandle): void => {
  const record = engine.castOf(cast);

  if (record !== undefined) {
    engine.unhold(record);
  }
};
