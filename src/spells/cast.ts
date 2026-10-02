import { NO_SOURCE } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { Random } from '../core/index.ts';
import type { ScaledSnapshot, StatView } from '../modifiers/index.ts';
import type { Proc, ProcOrigin, ProcOutcome } from '../procs/index.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import type { CastOutcome, CastStage, SpellContext, StatsContext } from './spell-def.ts';
import type { SpellHost } from './spell-host.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import type { StatsBox } from './stats-box.ts';

/** The stats of a spell that has none. */
export const NO_STATS: Readonly<Record<string, number>> = Object.freeze({});

/** The proc amounts of a spell whose stats are a function or absent. */
export const NO_SCALED: Readonly<Record<string, number | ScaledSnapshot>> = Object.freeze({});

/** What a `stats` function is called with, reused for every call. */
export class StatsCall<G extends SpellTypes> implements StatsContext<G> {
  caster: G['bearer'] | undefined = undefined;
  spell: SpellId = toId<'spells'>(0);
  rank = 1;
  view: StatView | undefined = undefined;
}

/** What a cast's own functions call back into: the engine that runs it. */
export interface CastServices<G extends SpellTypes> {
  /** The host. */
  readonly host: SpellHost<G> & G['host'];

  /** The spell clock's tick now. */
  readonly tick: number;

  /** The spell clock's step. */
  readonly dt: number;

  /** Applies one proc for a cast. */
  readonly applyFor: (cast: Cast<G>, proc: Proc<G>) => ProcOutcome;

  /** A draw source for a cast. */
  readonly randomFor: (stream: G['stream'] | undefined, key: readonly number[]) => Random;

  /** Runs a cast's `target` hook again. */
  readonly retarget: (cast: Cast<G>) => unknown;
}

/** Who a cast's procs run for, reused for every list the cast runs. */
export class CastOrigin<G extends SpellTypes> implements ProcOrigin<G> {
  self: G['bearer'];
  source = NO_SOURCE;

  constructor(self: G['bearer']) {
    this.self = self;
  }
}

/**
 * One cast, pooled: the context every hook of the cast receives, and the runner's own state for it. A class
 * for fast properties; its functions are arrow fields, so a hook may call them detached.
 */
export class Cast<G extends SpellTypes> implements SpellContext<G> {
  caster: G['bearer'];
  spell: SpellId = toId<'spells'>(0);
  cast: CastHandle = NO_CAST;
  source = NO_SOURCE;
  rank = 1;
  input: G['input'] | undefined = undefined;
  target: unknown = undefined;
  stats: Readonly<Record<string, unknown>> = NO_STATS;
  scaled: Readonly<Record<string, number | ScaledSnapshot>> = NO_SCALED;
  state: unknown = undefined;
  readonly ext: G['castExt'];
  stage: CastStage = 'ended';
  stageSeconds = 0;
  remaining = 0;
  elapsed = 0;
  outcome: CastOutcome<G> | undefined = undefined;
  startTick = 0;

  /** Its ordinal among the casts its caster started on `startTick`: two same-tick casts roll apart. */
  ordinal = 0;

  /** The key its predicted cast cue carries; 0 for none. */
  cueKey = 0;

  /** Whether its cooldowns started before it was cast (a press that committed them): it neither asks nor lands them. */
  isCommitted = false;

  /** Whether this cast skips checking and starting its spell's cooldowns. */
  ignoresCooldown = false;

  /** The caster's entity id, the second part of every key. */
  casterId = NO_SOURCE;

  /** Why its stage is paused, as bits: bit 0 for `spells.pause`, one bit per interrupt; 0 when it runs. */
  pauses = 0;

  /** Whether its windup's aim has locked. */
  isLocked = false;

  /** Seconds to its channel's next beat. */
  beat = 0;

  /** The seconds between its channel's beats, read as the channel started; 0 beats every step. */
  every = 0;

  /** How many of its release procs went off. */
  went = 0;

  /** Whether its payload went out. */
  hasReleased = false;

  /** Whether its `start` event went out: a cast ended in `begin` raises no `end` either. */
  hasStarted = false;

  /** Whether its stats were taken. */
  hasStats = false;

  /** How many callers keep its record from going back to the pool: its runner while it acts, its delayed procs. */
  holds = 0;

  /** Its stats storage, when its stats are a table. */
  box: StatsBox | undefined = undefined;

  /** Who its procs run for. */
  readonly origin: CastOrigin<G>;

  readonly #services: CastServices<G>;
  readonly #key = [0, 0, 0, 0, 0, 0];

  constructor(services: CastServices<G>, caster: G['bearer'], ext: G['castExt']) {
    this.#services = services;
    this.caster = caster;
    this.ext = ext;
    this.origin = new CastOrigin<G>(caster);
  }

  get tick(): number {
    return this.#services.tick;
  }

  get dt(): number {
    return this.#services.dt;
  }

  get host(): SpellHost<G> & G['host'] {
    return this.#services.host;
  }

  get isPaused(): boolean {
    return this.pauses !== 0;
  }

  readonly apply = (proc: Proc<G>): ProcOutcome => this.#services.applyFor(this, proc);

  readonly random = (stream?: G['stream'], targetId = 0, index = 0): Random =>
    this.#services.randomFor(stream, this.key(targetId, index));

  readonly key = (targetId = 0, index = 0): readonly number[] => {
    const key = this.#key;

    key[0] = this.startTick >>> 0;
    key[1] = this.casterId;
    key[2] = this.spell;
    key[3] = targetId;
    key[4] = index;
    key[5] = this.ordinal;

    return key;
  };

  readonly retarget = (): unknown => this.#services.retarget(this);
}
