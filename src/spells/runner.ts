import { NO_SOURCE } from '../auras/index.ts';
import { isRunOut } from '../core/index.ts';
import type { ActivationKindDef, CastSeconds } from './activation.ts';
import type { Cast } from './cast.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import type { AnySpellDef, CastOutcome, CastStage } from './spell-def.ts';
import type { ActivationShape, SpellId, SpellTypes } from './spell-types.ts';
import { autoIntervalOf, refreshLive, takeStats } from './take-stats.ts';

/** Why a cast was refused: the gates (the host's `canAct`, the activation kind's), `canCast`, or no target. */
export type CastRefusal = 'gate' | 'canCast' | 'target';

/** What starting a cast did (`spells.cast`), reused between calls, so read it at once. */
export interface CastReport {
  /** The cast's handle; stale at once for a cast that ended within the call; `NO_CAST` for a refusal. */
  readonly handle: CastHandle;

  /** `refused`, `running` (in a stage), or `ended` (it ran its whole course within the call). */
  readonly status: 'refused' | 'running' | 'ended';

  /** Why it was refused; `undefined` when it started. */
  readonly refusal: CastRefusal | undefined;

  /** How many of its release procs went off; 0 when it has not released yet (or was refused). */
  readonly went: number;

  /** Whether its payload went out within the call (a spell with no windup), whatever its procs did. */
  readonly hasReleased: boolean;

  /**
   * For an `auto` spell, its interval read at the cast (§II.6 S2), with the cast's stats (taken for a refusal at the
   * gate too, when the interval reads them); NaN for any other spell.
   */
  readonly interval: number;
}

/** How a cast is started, beyond the caster and the spell. */
export interface CastOptions<G extends SpellTypes> {
  /** What the activation hands it: an aim, a unit (`ctx.input`, the `target` hook's argument). */
  readonly input?: G['input'] | undefined;

  /** Its rank, from 1; 1 when absent. */
  readonly rank?: number | undefined;

  /** Its variant; 0 when absent. */
  readonly variant?: number | undefined;

  /** The entity id its hits are credited to; the caster's (`host.idOf`) when absent. */
  readonly source?: number | undefined;
}

/** No options: every default. */
export const NO_OPTIONS: CastOptions<never> = Object.freeze({});

/** What a cast is asked for: who casts which spell, how; a system reuses one. */
export interface CastRequest<G extends SpellTypes> {
  /** Who casts. */
  readonly caster: G['bearer'];

  /** The spell. */
  readonly spell: SpellId;

  /** How. */
  readonly options: CastOptions<G>;
}

/** The one report of a system, rewritten by every cast. */
export class Report implements CastReport {
  handle: CastHandle = NO_CAST;
  status: CastReport['status'] = 'refused';
  refusal: CastRefusal | undefined = undefined;
  went = 0;
  hasReleased = false;
  interval = Number.NaN;
}

/**
 * Whether a cast has ended: asked again after every hook and event, since their procs may end it (a function, so the
 * compiler does not carry an earlier check of the stage past the call).
 */
export const isEnded = <G extends SpellTypes>(cast: Cast<G>): boolean => cast.stage === 'ended';

/** Sets a fresh cast's fields from its options. */
const initCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  parts: { readonly spell: SpellId; readonly options: CastOptions<G> },
): void => {
  const { options } = parts;
  const casterId = engine.host.idOf?.(cast.caster) ?? NO_SOURCE;

  cast.spell = parts.spell;
  cast.rank = options.rank ?? 1;
  cast.variant = options.variant ?? 0;
  cast.input = options.input;
  cast.casterId = casterId;
  cast.source = options.source ?? casterId;
  cast.origin.source = cast.source;
  cast.startTick = engine.clock.tick;
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
  cast.hasStats = false;
};

/** The gates, then the stats: the host's `canAct`, then the activation kind's `gate`. */
const passesGates = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): boolean => {
  if (engine.host.canAct?.(cast.caster, cast.spell) === false) {
    return false;
  }

  const { registry } = engine;

  const kind: ActivationKindDef<ActivationShape, G> | undefined =
    registry.activations.defs[registry.columns.activation[cast.spell] ?? 0];

  return kind?.gate?.(def.activation, cast) !== false;
};

/** The cast order up to `begin` (§II.3.1): gates, stats, `canCast`, target. The refusal, or `undefined`. */
const admit = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  def: AnySpellDef<G>,
): CastRefusal | undefined => {
  if (!passesGates(engine, cast, def)) {
    return 'gate';
  }

  takeStats(engine, cast, def);

  const { hooks } = engine.registry;

  if (hooks.canCast[cast.spell]?.(cast) === false) {
    return 'canCast';
  }

  const target = hooks.target[cast.spell];

  if (target === undefined) {
    return undefined;
  }

  cast.target = target(cast, cast.input);

  return cast.target === undefined ? 'target' : undefined;
};

/** Enters a stage: its seconds read now (a function reads the cast), its clock reset. Throws for bad seconds. */
const enterStage = <G extends SpellTypes>(
  cast: Cast<G>,
  stage: Exclude<CastStage, 'ended'>,
  seconds: CastSeconds<G> | undefined,
): void => {
  const value = typeof seconds === 'function' ? seconds(cast) : (seconds ?? 0);

  if (!(value >= 0) || !Number.isFinite(value)) {
    throw new RangeError(`A cast's ${stage} must last a finite number of seconds from 0; got ${value}.`);
  }

  cast.stage = stage;
  cast.stageSeconds = value;
  cast.remaining = value;
  cast.elapsed = 0;
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

/** Runs `onCancel` (for a cancelled cast) and `onEnd`. */
const runEnd = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): void => {
  const list = engine.takeList();

  try {
    const onCancel = def.timeline?.onCancel;

    if (cast.outcome === 'cancelled' && onCancel !== undefined) {
      engine.run(cast, onCancel(cast, cast.target, list), list);
      list.clear();
    }

    const onEnd = engine.registry.hooks.onEnd[cast.spell];

    if (onEnd !== undefined) {
      engine.run(cast, onEnd(cast, cast.outcome ?? 'released', list), list);
    }
  } finally {
    engine.giveList(list);
  }
};

/**
 * Ends a cast (§II.3.3), once: it leaves its caster's casts, then `onCancel` for a cancel, its end cue, `onEnd`, its
 * cast aura comes off, and the `end` event. Its record goes back to the pool once nothing holds it.
 */
export const endCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, outcome: CastOutcome): void => {
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
  runEnd(engine, cast, def);
  engine.holdCastAura(cast, false);
  engine.raise('end', cast);
  engine.unhold(cast);
};

/** After the payload (the release, or the channel's end): the recovery when the spell has one, else the end. */
export const afterPayload = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  outcome: CastOutcome,
): void => {
  cast.outcome = outcome;

  const recover = engine.plans[cast.spell]?.recover;

  if (recover !== undefined) {
    enterStage(cast, 'recover', recover);

    if (!isRunOut(cast.remaining, engine.clock.countdown)) {
      return;
    }
  }

  endCast(engine, cast, outcome);
};

/**
 * Releases a cast (§II.3.1): its stats read again when live, its aim locked, its release cue, `release` and the
 * `release` event; then its channel, or what follows the payload.
 */
export const releaseCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>): void => {
  const def = engine.registry.get(cast.spell);

  refreshLive(engine, cast, def);
  cast.isLocked = true;
  engine.fire(cast, def.cues?.release?.(cast, cast.target));
  cast.hasReleased = true;
  cast.went = runRelease(engine, cast);

  if (isEnded(cast)) {
    return;
  }

  engine.raise('release', cast);

  if (isEnded(cast)) {
    return;
  }

  const plan = engine.plans[cast.spell];

  if (plan?.channel === undefined) {
    afterPayload(engine, cast, 'released');

    return;
  }

  enterStage(cast, 'channel', plan.channel);
  cast.beat = plan.every;

  if (isRunOut(cast.remaining, engine.clock.countdown)) {
    afterPayload(engine, cast, 'released');
  }
};

/**
 * Begins an admitted cast: it joins its caster's casts, makes its own state, puts on its cast aura, enters its windup,
 * fires its start cue, runs `begin` and raises `start`; a windup already run out releases at once.
 */
const beginCast = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): void => {
  recordOf(cast.caster).add(cast.cast);
  cast.state = engine.registry.hooks.state[cast.spell]?.();
  engine.holdCastAura(cast, true);
  enterStage(cast, 'windup', engine.plans[cast.spell]?.windup);
  cast.isLocked = engine.plans[cast.spell]?.track === undefined;
  engine.fire(cast, def.cues?.start?.(cast, cast.target));
  runBegin(engine, cast);

  if (isEnded(cast)) {
    return;
  }

  engine.raise('start', cast);

  if (cast.stage === 'windup' && isRunOut(cast.remaining, engine.clock.countdown)) {
    releaseCast(engine, cast);
  }
};

/**
 * Starts a cast in the cast order (§II.3.1): the gates, the stats, `canCast`, the target, then `begin`, and the
 * release at once for a spell with no windup. Writes what it did into `report` and returns it.
 */
export const startCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  request: CastRequest<G>,
  report: Report,
): CastReport => {
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
