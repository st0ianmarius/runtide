import { NO_SOURCE } from '../auras/index.ts';
import { isRunOut } from '../core/index.ts';
import type { ActivationKindDef } from './activation.ts';
import { fireCastCue } from './cast-cue.ts';
import type { CastOptions, CastRefusal, CastRequest, GateAnswer, Report } from './cast-request.ts';
import type { Cast } from './cast.ts';
import { recordOf, stopThrown } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import { NO_CAST } from './ids.ts';
import { isEnded, releaseCast } from './payload.ts';
import { checkReach } from './reach.ts';
import type { AnySpellDef } from './spell-def.ts';
import type { ActivationShape, SpellId, SpellTypes } from './spell-types.ts';
import { checkStages, enterStage } from './stage-seconds.ts';
import { autoIntervalOf, isLive, takeStats } from './take-stats.ts';

/** A cast's rank, checked: a whole number from 1 (above the spell's ranks, its stats read the top one). */
const rankFor = <G extends SpellTypes>(engine: SpellEngine<G>, spell: SpellId, rank: number): number => {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new RangeError(`${engine.registry.name(spell)} cast at rank ${rank}: a rank is a whole number from 1.`);
  }

  return rank;
};

/** Sets a fresh cast's fields from its options. */
const initCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  parts: { readonly spell: SpellId; readonly options: CastOptions<G> }
): void => {
  const { options } = parts;

  checkStages(options.stages);

  const casterId = engine.host.idOf?.(cast.caster) ?? NO_SOURCE;

  cast.spell = parts.spell;
  cast.rank = rankFor(engine, parts.spell, options.rank ?? engine.host.rankOf?.(cast.caster, parts.spell) ?? 1);
  cast.input = options.input;
  cast.casterId = casterId;
  cast.source = options.source ?? casterId;
  cast.origin.source = cast.source;
  cast.startTick = engine.clock.tick;
  cast.ordinal = recordOf(cast.caster).ordinalAt(cast.startTick);
  cast.cueKey = options.key ?? 0;
  cast.isCommitted = options.committed === true;
  cast.ignoresCooldown = options.ignoreCooldown === true;
  cast.windupSeconds = options.stages?.windup;
  cast.channelSeconds = options.stages?.channel;
  cast.recoverSeconds = options.stages?.recover;
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
  cast.hasRaisedRelease = false;
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

/**
 * Whether the caster holds an interrupt the spell answers by cancelling (a stun, a death): such a cast never starts,
 * so it takes no cooldown either.
 */
const isCancelledNow = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): boolean => {
  const cancels = engine.cancelMasks[cast.spell] ?? 0;

  return cancels !== 0 && (recordOf(cast.caster).interrupts & cancels) !== 0;
};

/**
 * The cast order up to `begin`: gates, an interrupt the caster holds that the spell answers by cancelling, cooldown,
 * stats, `canCast`, target, reach. The refusal, or `undefined`.
 */
const admit = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  def: AnySpellDef<G>
): CastRefusal<G> | undefined => {
  const gated = passGates(engine, cast, def);

  if (gated !== undefined) {
    return gated;
  }

  if (isCancelledNow(engine, cast)) {
    return 'interrupted';
  }

  if (!cast.isCommitted && !cast.ignoresCooldown && engine.cooldowns.isCooling(cast.caster, cast.spell)) {
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

/**
 * Enters an admitted cast: it joins its caster's casts, makes its own state, enters its windup, paused by any interrupt
 * its caster holds that it answers by pausing, then starts its cooldowns (unless committed or ignored), whose auras'
 * hooks may end it.
 */
const enterCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const record = recordOf(cast.caster);

  record.add(cast.cast);
  cast.state = engine.registry.hooks.state[cast.spell]?.();

  enterStage(cast, 'windup', cast.windupSeconds ?? engine.plans[cast.spell]?.windup);
  cast.pauses = record.interrupts & (engine.pauseMasks[cast.spell] ?? 0);
  cast.isLocked = engine.plans[cast.spell]?.track === undefined;

  if (!cast.isCommitted && !cast.ignoresCooldown) {
    engine.cooldowns.start(cast, 'start');
  }
};

/**
 * Begins an admitted cast: enters it, fires its cast and start cues, runs `begin` and raises `start`; a windup already
 * run out releases at once, unless the cast starts paused.
 */
const beginCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): void => {
  enterCast(engine, cast);

  if (isEnded(cast)) {
    return;
  }

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
 * Starts a cast in the cast order: the gates, the stats, `canCast`, the target, the press's `onAdmit`, then `begin`,
 * and the release at once for a spell with no windup. Writes what it did into `report` and returns it.
 */
export const startCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  request: CastRequest<G>,
  report: Report<G>
): Report<G> => {
  // Checked before a record is taken: a retired or unknown spell throws here.
  const def = engine.registry.get(request.spell);

  // Read before any hook runs: a nested cast (one `onAdmit` starts) may reuse the request.
  const { onAdmit } = request.options;

  // Admitted on a scratch record, so a refusal takes no pool slot; only an admitted cast moves into the pool. The
  // scratch records nest, so an `onAdmit` that casts another spell asks it on a record of its own.
  const asked = engine.borrow(request.caster);
  let refusal: CastRefusal<G> | undefined;
  let interval = Number.NaN;

  try {
    initCast(engine, asked, request);
    refusal = admit(engine, asked, def);
    interval = autoIntervalOf(engine, asked, def);

    if (refusal === undefined && onAdmit !== undefined) {
      refusal = refusalOf(onAdmit(asked), 'gate');
      // A cast it started on the same caster took the ordinal this one asked with.
      asked.ordinal = recordOf(asked.caster).ordinalAt(asked.startTick);
    }
  } catch (error) {
    engine.giveBack(asked);

    throw error;
  }

  if (refusal !== undefined) {
    engine.giveBack(asked);
    report.handle = NO_CAST;
    report.status = 'refused';
    report.refusal = refusal;
    report.went = 0;
    report.hasReleased = false;
    report.interval = interval;

    return report;
  }

  const cast = engine.adopt(asked);

  try {
    return runStart(engine, cast, def, interval, report);
  } catch (error) {
    stopThrown(cast);
    engine.unhold(cast);

    throw error;
  }
};

/**
 * An `auto` spell's interval as its cast's call ends: a live spell's read again with its stats as they are now (its
 * end took them, or they are taken again), so a haste its own release gave its caster counts at this cast; a snapshot
 * spell's as read at the cast, with the stats it began with.
 */
const intervalAfter = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  def: AnySpellDef<G>,
  interval: number
): number => {
  if (Number.isNaN(interval) || !isLive(engine, cast.spell)) {
    return interval;
  }

  if (!isEnded(cast)) {
    takeStats(engine, cast, def);
  }

  return autoIntervalOf(engine, cast, def);
};

/** The cast order of `startCast` from `begin` on its admitted cast, which it lets go of when done. */
const runStart = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  def: AnySpellDef<G>,
  interval: number,
  report: Report<G>
): Report<G> => {
  recordOf(cast.caster).countStart();
  beginCast(engine, cast, def);

  const { went, hasReleased } = cast;
  const status = isEnded(cast) ? 'ended' : 'running';

  const read = intervalAfter(engine, cast, def, interval);

  engine.unhold(cast);
  report.handle = cast.cast;
  report.status = status;
  report.refusal = undefined;
  report.went = went;
  report.hasReleased = hasReleased;
  report.interval = read;

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
  const cast = engine.borrow(request.caster);

  try {
    initCast(engine, cast, request);

    return admit(engine, cast, def);
  } finally {
    engine.giveBack(cast);
  }
};

/**
 * Starts every cooldown of a spell on a caster now, read from a cast of it that goes no further than its stats (a press
 * that commits at once, on the server and a prediction mirror alike), those on the release a windup longer, so each
 * ends when the cast's own would. Its casts then go with `committed`.
 */
export const startCooldowns = <G extends SpellTypes>(engine: SpellEngine<G>, request: CastRequest<G>): void => {
  const def = engine.registry.get(request.spell);
  checkStages(request.options.stages);

  const windup = request.options.stages?.windup ?? engine.plans[request.spell]?.windup;

  if (!engine.cooldowns.readsCast(request.spell) && typeof windup !== 'function') {
    engine.cooldowns.startConstant(request.caster, request.spell, windup ?? 0);

    return;
  }

  const cast = engine.borrow(request.caster);

  try {
    initCast(engine, cast, request);
    takeStats(engine, cast, def);
    engine.cooldowns.start(cast, 'all', typeof windup === 'function' ? windup(cast) : (windup ?? 0));
  } finally {
    engine.giveBack(cast);
  }
};
