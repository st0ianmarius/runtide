import { NO_SOURCE } from '../auras/index.ts';
import { isRunOut } from '../core/index.ts';
import type { ActivationKindDef } from './activation.ts';
import { fireCastCue } from './cast-cue.ts';
import type { CastOptions, CastRefusal, CastRequest, GateAnswer, Report } from './cast-request.ts';
import type { Cast } from './cast.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import { NO_CAST } from './ids.ts';
import { checkReach } from './reach.ts';
import type { AnySpellDef, CastOutcome } from './spell-def.ts';
import type { ActivationShape, SpellId, SpellTypes } from './spell-types.ts';
import { beatSeconds, enterStage } from './stage-seconds.ts';
import { autoIntervalOf, refreshLive, takeStats } from './take-stats.ts';

/**
 * Whether a cast has ended: asked again after every hook and event, since their procs may end it (a function, so the
 * compiler does not carry an earlier check of the stage past the call).
 */
export const isEnded = <G extends SpellTypes>(cast: Cast<G>): boolean => cast.stage === 'ended';

/** Sets a fresh cast's fields from its options. */
const initCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  parts: { readonly spell: SpellId; readonly options: CastOptions<G> }
): void => {
  const { options } = parts;
  const casterId = engine.host.idOf?.(cast.caster) ?? NO_SOURCE;

  cast.spell = parts.spell;
  cast.rank = options.rank ?? engine.host.rankOf?.(cast.caster, parts.spell) ?? 1;
  cast.input = options.input;
  cast.casterId = casterId;
  cast.source = options.source ?? casterId;
  cast.origin.source = cast.source;
  cast.startTick = engine.clock.tick;
  cast.ordinal = recordOf(cast.caster).ordinalAt(cast.startTick);
  cast.cueKey = options.key ?? 0;
  cast.isCommitted = options.committed === true;
  cast.target = undefined;
  cast.state = undefined;
  cast.outcome = undefined;
  cast.stage = 'windup';
  cast.stageSeconds = 0;
  cast.remaining = 0;
  cast.elapsed = 0;
  cast.pauses = 0;
  cast.isLocked = false;
  cast.beat = 0;
  cast.went = 0;
  cast.hasReleased = false;
  cast.hasStarted = false;
  cast.hasStats = false;
};

/** The refusal a gate's answer makes: none for true or nothing, the gate's own for false, else the game's reason. */
const refusalOf = <G extends SpellTypes>(
  answer: GateAnswer<G> | undefined,
  plain: CastRefusal<G>
): CastRefusal<G> | undefined => {
  if (answer === undefined || answer === true) {
    return undefined;
  }

  return answer === false ? plain : answer;
};

/** The gates: the host's `canAct`, then the activation kind's `gate`. The refusal, or `undefined`. */
const passGates = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  def: AnySpellDef<G>
): CastRefusal<G> | undefined => {
  const byHost = refusalOf(engine.host.canAct?.(cast.caster, cast.spell), 'gate');

  if (byHost !== undefined) {
    return byHost;
  }

  const { registry } = engine;

  const kind: ActivationKindDef<ActivationShape, G> | undefined =
    registry.activations.defs[registry.columns.activation[cast.spell] ?? 0];

  return refusalOf(kind?.gate?.(def.activation, cast), 'gate');
};

/** The cast order up to `begin`: gates, cooldown, stats, `canCast`, target, reach. The refusal, or `undefined`. */
const admit = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  def: AnySpellDef<G>
): CastRefusal<G> | undefined => {
  const gated = passGates(engine, cast, def);

  if (gated !== undefined) {
    return gated;
  }

  if (!cast.isCommitted && engine.cooldowns.isCooling(cast.caster, cast.spell)) {
    return 'cooldown';
  }

  takeStats(engine, cast, def);

  const { hooks } = engine.registry;
  const refused = refusalOf(hooks.canCast[cast.spell]?.(cast), 'canCast');

  if (refused !== undefined) {
    return refused;
  }

  const target = hooks.target[cast.spell];

  if (target === undefined) {
    return undefined;
  }

  cast.target = target(cast, cast.input);

  if (cast.target === undefined) {
    return 'target';
  }

  const reach = engine.plans[cast.spell]?.reach;

  return reach === undefined ? undefined : checkReach(engine, cast, reach);
};

/** Runs `begin`: its procs for the caster; how many went off. */
const runBegin = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): number => {
  const begin = engine.registry.hooks.begin[cast.spell];

  if (begin === undefined) {
    return 0;
  }

  const list = engine.takeList();

  try {
    return engine.run(cast, begin(cast, cast.target, list), list);
  } finally {
    engine.giveList(list);
  }
};

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

/**
 * Ends a cast, once: it leaves its caster's casts, then its end cue, `onEnd` and the `end`
 * event. Its record goes back to the pool once nothing holds it.
 */
export const endCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, outcome: CastOutcome<G>): void => {
  if (cast.stage === 'ended') {
    return;
  }

  const def = engine.registry.get(cast.spell);

  cast.holds += 1;
  refreshLive(engine, cast, def);
  cast.stage = 'ended';
  cast.outcome = outcome;
  cast.remaining = 0;
  recordOf(cast.caster).remove(cast.cast);
  engine.fire(cast, def.cues?.end?.(cast, outcome));
  runEnd(engine, cast);

  if (cast.hasStarted) {
    engine.raise('end', cast);
  }

  engine.unhold(cast);
};

/** After the payload (the release, or the channel's end): the recovery when the spell has one, else the end. */
export const afterPayload = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  outcome: CastOutcome<G>
): void => {
  cast.outcome = outcome;

  const recover = engine.plans[cast.spell]?.recover;

  if (recover !== undefined) {
    enterStage(cast, 'recover', recover);

    if (!isRunOut(cast.remaining)) {
      return;
    }
  }

  endCast(engine, cast, outcome);
};

/**
 * Releases a cast: its stats read again when live, its aim locked, its release cue, `release` and the
 * `release` event; then its channel, or what follows the payload.
 */
export const releaseCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const def = engine.registry.get(cast.spell);

  refreshLive(engine, cast, def);
  cast.isLocked = true;

  if (!cast.isCommitted) {
    engine.cooldowns.start(cast, 'release');
  }

  engine.fire(cast, def.cues?.release?.(cast, cast.target));
  cast.hasReleased = true;
  cast.went = runRelease(engine, cast);

  // A `release` hook or listener may have ended or finished it: then it is past its windup.
  if (cast.stage !== 'windup') {
    return;
  }

  engine.raise('release', cast);

  if (cast.stage !== 'windup') {
    return;
  }

  const plan = engine.plans[cast.spell];

  if (plan?.channel === undefined) {
    afterPayload(engine, cast, 'released');

    return;
  }

  enterStage(cast, 'channel', plan.channel);
  cast.every = beatSeconds(cast, plan.every);
  cast.beat = cast.every;

  if (isRunOut(cast.remaining)) {
    afterPayload(engine, cast, 'released');
  }
};

/**
 * Enters an admitted cast: it joins its caster's casts, makes its own state, starts its cooldowns (unless a press
 * committed them), enters its windup, paused by any interrupt its caster holds that it answers by pausing.
 */
const enterCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const record = recordOf(cast.caster);

  record.add(cast.cast);
  cast.state = engine.registry.hooks.state[cast.spell]?.();

  if (!cast.isCommitted) {
    engine.cooldowns.start(cast, 'start');
  }

  enterStage(cast, 'windup', engine.plans[cast.spell]?.windup);
  cast.pauses = record.interrupts & (engine.pauseMasks[cast.spell] ?? 0);
  cast.isLocked = engine.plans[cast.spell]?.track === undefined;
};

/**
 * Begins an admitted cast: enters it, fires its cast and start cues, runs `begin` and raises `start`; a windup already
 * run out releases at once, unless the cast starts paused.
 */
const beginCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): void => {
  enterCast(engine, cast);

  if (def.cues?.cast !== undefined) {
    fireCastCue(engine, cast.caster, [cast.spell, cast.input, cast.cueKey, cast.rank]);
  }

  engine.fire(cast, def.cues?.start?.(cast, cast.target));
  runBegin(engine, cast);

  if (isEnded(cast)) {
    return;
  }

  cast.hasStarted = true;
  engine.raise('start', cast);

  if (cast.stage === 'windup' && cast.pauses === 0 && isRunOut(cast.remaining)) {
    releaseCast(engine, cast);
  }
};

/**
 * Starts a cast in the cast order: the gates, the stats, `canCast`, the target, then `begin`, and the
 * release at once for a spell with no windup. Writes what it did into `report` and returns it.
 */
export const startCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  request: CastRequest<G>,
  report: Report<G>
): Report<G> => {
  const def = engine.registry.get(request.spell);
  const cast = engine.acquire(request.caster);

  initCast(engine, cast, request);

  const refusal = admit(engine, cast, def);
  const interval = autoIntervalOf(engine, cast, def);

  if (refusal !== undefined) {
    cast.stage = 'ended';
    engine.unhold(cast);
    report.handle = NO_CAST;
    report.status = 'refused';
    report.refusal = refusal;
    report.went = 0;
    report.hasReleased = false;
    report.interval = interval;

    return report;
  }

  beginCast(engine, cast, def);

  const { went, hasReleased } = cast;
  const status = isEnded(cast) ? 'ended' : 'running';

  engine.unhold(cast);
  report.handle = cast.cast;
  report.status = status;
  report.refusal = undefined;
  report.went = went;
  report.hasReleased = hasReleased;
  report.interval = interval;

  return report;
};

/**
 * Asks whether a cast would start (a picker reading each spell's cast rules), running the cast order up to
 * `begin` (the gates, the stats, `canCast`, the target and its reach) and starting nothing. The refusal, or
 * `undefined`. The hooks it runs must not change the world, as the cast order's never do.
 */
export const checkCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  request: CastRequest<G>
): CastRefusal<G> | undefined => {
  const def = engine.registry.get(request.spell);
  const cast = engine.acquire(request.caster);

  initCast(engine, cast, request);

  try {
    return admit(engine, cast, def);
  } finally {
    cast.stage = 'ended';
    engine.unhold(cast);
  }
};

/**
 * Starts every cooldown of a spell on a caster now, read from a cast of it that goes no further than its stats (a press
 * that commits at once, on the server and a prediction mirror alike). Its casts then go with `committed`.
 */
export const startCooldowns = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  request: CastRequest<G>,
  asCast = false
): void => {
  const def = engine.registry.get(request.spell);
  const windup = asCast ? engine.plans[request.spell]?.windup : undefined;

  if (!engine.cooldowns.readsCast(request.spell) && typeof windup !== 'function') {
    engine.cooldowns.startConstant(request.caster, request.spell, windup ?? 0);

    return;
  }

  const cast = engine.acquire(request.caster);

  initCast(engine, cast, request);

  try {
    takeStats(engine, cast, def);
    engine.cooldowns.start(cast, 'all', typeof windup === 'function' ? windup(cast) : (windup ?? 0));
  } finally {
    cast.stage = 'ended';
    engine.unhold(cast);
  }
};
