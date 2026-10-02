import { isRunOut } from '../core/index.ts';
import type { Cast } from './cast.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import type { CastOutcome } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';
import { beatSeconds, enterStage } from './stage-seconds.ts';
import { refreshLive } from './take-stats.ts';

/**
 * Whether a cast has ended: asked again after every hook and event, since their procs may end it (a function, so the
 * compiler does not carry an earlier check of the stage past the call).
 */
export const isEnded = <G extends SpellTypes>(cast: Cast<G>): boolean => cast.stage === 'ended';

/** Runs `release`: its procs for the caster; how many went off. */
const runRelease = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): number => {
  const release = engine.registry.hooks.release[cast.spell];
  const list = engine.takeList();

  try {
    return release === undefined ? 0 : engine.run(cast, release(cast, cast.target, list), list);
  } finally {
    engine.giveList(list);
  }
};

/** Runs `onEnd`. */
const runEnd = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const list = engine.takeList();

  try {
    const onEnd = engine.registry.hooks.onEnd[cast.spell];

    if (onEnd !== undefined) {
      engine.run(cast, onEnd(cast, cast.outcome ?? 'released', list), list);
    }
  } finally {
    engine.giveList(list);
  }
};

/** Raises a cast's `release` event, once. */
const raiseRelease = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  cast.hasRaisedRelease = true;
  engine.raise('release', cast);
};

/**
 * Ends a cast, once: it leaves its caster's casts, then the `release` event of a cast that ended within its release
 * (a `release` hook that finished it, procs that killed its caster), its end cue, `onEnd` and the `end` event. Its
 * record goes back to the pool once nothing holds it.
 */
export const endCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, outcome: CastOutcome<G>): void => {
  if (cast.stage === 'ended') {
    return;
  }

  const def = engine.registry.get(cast.spell);

  cast.holds += 1;
  cast.stage = 'ended';
  cast.outcome = outcome;
  cast.remaining = 0;
  recordOf(cast.caster).remove(cast.cast);

  try {
    refreshLive(engine, cast, def);

    if (cast.hasStarted && cast.hasReleased && !cast.hasRaisedRelease) {
      raiseRelease(engine, cast);
    }

    engine.fire(cast, def.cues?.end?.(cast, outcome));
    runEnd(engine, cast);

    if (cast.hasStarted) {
      engine.raise('end', cast);
    }
  } finally {
    engine.unhold(cast);
  }
};

/** After the payload (the release, or the channel's end): the recovery when the spell has one, else the end. */
export const afterPayload = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  outcome: CastOutcome<G>
): void => {
  if (cast.stage === 'ended') {
    return;
  }

  cast.outcome = outcome;

  const recover = cast.recoverSeconds ?? engine.plans[cast.spell]?.recover;

  if (recover !== undefined) {
    enterStage(cast, 'recover', recover);

    if (!isRunOut(cast.remaining)) {
      return;
    }
  }

  endCast(engine, cast, outcome);
};

/** Starts the channel after release, or moves straight to recovery when it has none or lasts zero seconds. */
const afterRelease = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const plan = engine.plans[cast.spell];
  const channel = cast.channelSeconds ?? plan?.channel;

  if (channel === undefined) {
    afterPayload(engine, cast, 'released');

    return;
  }

  enterStage(cast, 'channel', channel);
  cast.every = beatSeconds(cast, plan?.every);
  cast.beat = cast.every;

  if (isRunOut(cast.remaining)) {
    afterPayload(engine, cast, 'released');
  }
};

/**
 * Releases a cast: its stats read again when live, its aim locked, its release cue, `release` and the
 * `release` event; then its channel, or what follows the payload. A cooldown aura's hooks may end it first, with no
 * release; a cast its `release` ended raises the event as it ends, and one it finished as it enters its recovery.
 */
export const releaseCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const def = engine.registry.get(cast.spell);

  refreshLive(engine, cast, def);
  cast.isLocked = true;

  if (!cast.isCommitted && !cast.ignoresCooldown) {
    engine.cooldowns.start(cast, 'release');

    if (cast.stage !== 'windup') {
      return;
    }
  }

  engine.fire(cast, def.cues?.release?.(cast, cast.target));
  cast.hasReleased = true;
  cast.went = runRelease(engine, cast);

  // A `release` hook may have ended its cast (its end raised the event) or finished it into its recovery.
  if (!isEnded(cast)) {
    raiseRelease(engine, cast);
  }

  if (cast.stage !== 'windup') {
    return;
  }

  afterRelease(engine, cast);
};
