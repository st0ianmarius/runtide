import type { AuraId } from '../auras/index.ts';
import type { Random } from '../core/index.ts';
import type { CueSpec } from '../cues/index.ts';
import type { Shape, Vec2 } from '../math/index.ts';
import type { Scaled, ScaledSnapshot, StatView } from '../modifiers/index.ts';
import type { Proc, ProcOutcome } from '../procs/index.ts';
import type { Activation, CastSeconds } from './activation.ts';
import type { GateAnswer } from './cast-request.ts';
import type { CastHandle } from './ids.ts';
import type { MirrorCtx } from './mirror.ts';
import type { ProcOut } from './proc-out.ts';
import type { Reach } from './reach.ts';
import type { SpellHost } from './spell-host.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import type { Timeline } from './timeline.ts';

/**
 * Where a cast is in its timeline: `windup` (counting to the release), `channel` (the payload running over
 * time), `recover` (busy after it), then `ended`. The brain reads it for its movement (holding ground, facing).
 */
export type CastStage = 'windup' | 'channel' | 'recover' | 'ended';

/**
 * How a cast ended: `released` (its payload went out and its channel ran its course), `cancelled` (an interrupt, a
 * death, `spells.cancel`, or a windup's `cancelIf`), `broken` (a channel's `breakIf`: a tether's target left), or one
 * of the game's own (`blocked`: it ended a charge into a wall so with `spells.finish`).
 */
export type CastOutcome<G extends SpellTypes = SpellTypes> = 'released' | 'cancelled' | 'broken' | G['castOutcome'];

/** What a spell's `stats` is: a table of scaled values, or a function of the cast. */
export type StatsSource<G extends SpellTypes> =
  | Readonly<Record<string, Scaled<G['stat']>>>
  | {
      /** Makes the stats; declared as a method so a function over a narrower context still fits. */
      bivarianceHack(ctx: StatsContext<G>): Readonly<Record<string, unknown>>;
    }['bivarianceHack'];

/** The stats a cast reads (`ctx.stats`): a table's numbers, or what the function returns. */
export type StatsOf<Source> = Source extends (ctx: never) => infer Stats
  ? Stats
  : { readonly [Key in keyof Source]: number };

/**
 * The amounts a cast hands its procs (`ctx.scaled`): each entry of a stats table as a scaled snapshot whose target
 * terms a `damage` or `heal` proc finishes at the hit, or its number when it has none; empty for the function form.
 */
export type ScaledOf<Source> = Source extends (ctx: never) => unknown
  ? Readonly<Record<never, never>>
  : { readonly [Key in keyof Source]: number | ScaledSnapshot };

/**
 * What a spell's `stats` function reads: who casts, at which rank, with what, and their stats. It has no world, so a
 * preview (`previewStats`) calls it too, with no caster.
 */
export interface StatsContext<G extends SpellTypes> {
  /** Who casts; `undefined` in a preview. */
  readonly caster: G['bearer'] | undefined;

  /** The spell. */
  readonly spell: SpellId;

  /** Its rank, from 1. */
  readonly rank: number;

  /** The caster's stats for this spell (`host.statsOf`), when there are any. */
  readonly view: StatView | undefined;
}

/**
 * What an area, a projectile or any delivery caught, handed to `onHit` in one call (`spells.hit`): every unit, in the
 * world's order, and where and how it caught them.
 */
export interface SpellHit<G extends SpellTypes, Target = unknown> {
  /** Every unit caught, in the world's order. */
  readonly targets: readonly G['bearer'][];

  /** The cast's target as it stands. */
  readonly target: Target | undefined;

  /** Where the delivery landed, if it says. */
  readonly at?: Vec2 | undefined;

  /** The shape that caught them, if it says. */
  readonly shape?: Shape | undefined;
}

/**
 * What the gates read (the host's `canAct`, the activation kind's `gate`): who casts what, with which input, credited
 * to whom. The stats are not taken and the target not picked yet. It has no host, so a kind written for one game still
 * registers with any; a game's own kind reaches its world through what it closes over.
 */
export interface GateContext<G extends SpellTypes> {
  /** Who casts. */
  readonly caster: G['bearer'];

  /** The spell cast. */
  readonly spell: SpellId;

  /** This cast's handle. */
  readonly cast: CastHandle;

  /** The entity id its hits are credited to (the caster's, or what the cast was started with). */
  readonly source: number;

  /** Its rank, from 1. */
  readonly rank: number;

  /** What the activation handed it. */
  readonly input: G['input'] | undefined;

  /** The spell clock's tick now. */
  readonly tick: number;

  /** The spell clock's step, in seconds. */
  readonly dt: number;
}

/**
 * What every spell hook receives: the caster and credit, the cast (its target, stats, own state, stage and
 * time), and the services a hook may use. It is the cast itself, pooled, so a hook reads it while it runs and never
 * keeps it; a delayed proc keeps the cast alive instead (`spells.isLive`). Its functions may be called detached.
 */
export interface SpellContext<
  G extends SpellTypes,
  Source extends StatsSource<G> = StatsSource<G>,
  Target = unknown,
  State = unknown
> extends GateContext<G> {
  /** The host: the framework services and the game's own. */
  readonly host: SpellHost<G> & G['host'];

  /** Where it goes: what `target` picked, as tracking left it. */
  readonly target: Target | undefined;

  /** Its stats as plain numbers: the snapshot taken at the start, or read again before every hook for a `live` spell. */
  readonly stats: StatsOf<Source>;

  /** Its stats as proc amounts: scaled snapshots whose target terms finish at the hit. */
  readonly scaled: ScaledOf<Source>;

  /** Its own state, shared by every delivery and delayed proc of the cast (`SpellDef.state`). */
  readonly state: State;

  /** The game's own fields. */
  readonly ext: G['castExt'];

  /** Where it is in its timeline. */
  readonly stage: CastStage;

  /** The seconds its current stage lasts. */
  readonly stageSeconds: number;

  /** The seconds left in its current stage. */
  readonly remaining: number;

  /** The seconds spent in its current stage. */
  readonly elapsed: number;

  /** Whether its stage is paused (by `spells.pause` or an interrupt), so it does not count down. */
  readonly isPaused: boolean;

  /** How it ended, or is ending: `undefined` until its payload went out or it was stopped. */
  readonly outcome: CastOutcome<G> | undefined;

  /** The tick it started on. */
  readonly startTick: number;

  /** Applies one proc now, for the caster and credited to the cast, and returns what it did. */
  readonly apply: (proc: Proc<G>) => ProcOutcome;

  /**
   * A draw source: a named stream of the host's table, or the spells' own without a name. A keyed stream is keyed by
   * `key(targetId, index)`, so its draws depend on that key alone: pass each target's id (and an index for several
   * rolls on one target), or every call rolls the same (a nova critting all or none).
   */
  readonly random: (stream?: G['stream'], targetId?: number, index?: number) => Random;

  /**
   * The cast's keyed-roll key: `(startTick, casterId, spellId, targetId, index)` in a reused array, read at
   * once; two rolls that must differ in one cast differ in `targetId` or `index`.
   */
  readonly key: (targetId?: number, index?: number) => readonly number[];

  /** Runs the spell's `target` hook again with the cast's input: what tracking re-aims with; `undefined` for none. */
  readonly retarget: () => Target | undefined;
}

/**
 * What a hook returns: a list of procs, the reusable `out` it was handed after pushing into it (no allocation), or
 * `undefined` for nothing.
 */
export type ProcReturn<G extends SpellTypes> = readonly Proc<G>[] | ProcOut<G> | undefined;

/**
 * The cues a spell fires at its moments: each hook returns a `CueSpec` (typed per cue with `CueSpecOf`) or
 * `undefined`, fired into the system's cue buffer on the caster, before the moment's event.
 */
export interface SpellCues<G extends SpellTypes, Source extends StatsSource<G>, Target, State> {
  /**
   * The cast as its caster's own client predicts it: mirror-safe, it reads only a `MirrorCtx` (the
   * caster, the input, its stats for the spell, the static world), so the prediction mirror fires it at the press
   * (`spells.predictCast`) and the server as the cast starts, both with the cast's key, and the client drops the
   * server's echo. It must return a predicted cue. It fires before `start`.
   */
  cast?(this: void, ctx: MirrorCtx<G>): CueSpec | undefined;

  /** The cast starts (its windup, or an instant release). */
  start?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target): CueSpec | undefined;

  /** The payload goes out. */
  release?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target): CueSpec | undefined;

  /** A delivery caught units. */
  hit?(this: void, ctx: SpellContext<G, Source, Target, State>, hit: SpellHit<G, Target>): CueSpec | undefined;

  /** A channel beat. */
  tick?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target): CueSpec | undefined;

  /** The cast ends. */
  end?(this: void, ctx: SpellContext<G, Source, Target, State>, outcome: CastOutcome<G>): CueSpec | undefined;
}

/**
 * One of a spell's cooldowns: an aura on the caster that refuses its casts (as `cooldown`) while held, landed as a cast
 * starts (or releases), for `seconds` or the aura's own duration. Spells that name one aura share it (a category: every
 * potion, a global cooldown). `spells.check`, a picker and a button see it, as they see the gates.
 */
export interface SpellCooldown<G extends SpellTypes, Source extends StatsSource<G> = StatsSource<G>> {
  /** The aura: its name in data, its id in code. */
  readonly aura: G['auraName'] | AuraId;

  /** Its seconds, read from the cast as it lands (a stat scales them); the aura's own duration when absent. */
  readonly seconds?: CastSeconds<G, Source>;

  /** When it lands: as the cast starts (`start`, the default), or as it releases, once its windup is done. */
  readonly startsOn?: 'start' | 'release';
}

/**
 * A spell: plain data and standalone hooks returning procs, registered by name (`defineSpells`), with no id
 * of its own. `Source` is its stats' form, `Target` what its `target` hook picks, `State` its casts' own state.
 */
export interface SpellDef<
  G extends SpellTypes,
  Source extends StatsSource<G> = StatsSource<G>,
  Target = unknown,
  State = unknown
> {
  /** Its tags: modifier scopes, trigger filters, the class of the spell. */
  readonly tags?: readonly G['spellTag'][];

  /** Who pulls its trigger, and that system's rules as data. */
  readonly activation: Activation<G, Source>;

  /** Its ranks: every per-rank list in its stats has this many entries; 1 when absent. */
  readonly ranks?: number;

  /** Its numbers for a cast: a table of scaled values, or a function; none when absent. */
  readonly stats?: Source;

  /**
   * Its share of each outgoing multiplier stat, 1 for a stat it leaves out: `{ damage: 1.1 }` takes 110%
   * of the damage bonus. The damage pipeline reads it through `spells.shareOf`.
   */
  readonly scaling?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Whether hooks read its stats live (evaluated again before every hook) instead of the snapshot taken at the start. */
  readonly live?: boolean;

  /** The game's own data, which the framework never reads. */
  readonly data?: G['spellData'];

  /** How the cast unfolds in time; an instant release when absent. */
  readonly timeline?: Timeline<G, Source, Target, State>;

  /** The cues it fires at its moments. */
  readonly cues?: SpellCues<G, Source, Target, State>;

  /** Its reach rules, asked after `target`: a range, a clear line. */
  readonly reach?: Reach<G, Source, Target>;

  /** Its cooldowns (its own, a category's, a global one), asked right after the gates; none when absent. */
  readonly cooldown?: SpellCooldown<G, Source> | readonly SpellCooldown<G, Source>[];

  /** Makes a cast's own state, once per cast (`ctx.state`); `undefined` when absent. */
  state?(this: void): State;

  /** The gate after the activation's own: false refuses the cast as `canCast`, one of the game's reasons for that reason. */
  canCast?(this: void, ctx: SpellContext<G, Source, Target, State>): GateAnswer<G>;

  /** Where the cast goes, from the activation's input; `undefined` refuses it. Absent: the cast needs no target. */
  target?(this: void, ctx: SpellContext<G, Source, unknown, State>, input: G['input'] | undefined): Target | undefined;

  /** The windup's start: telegraphs, the caster's motion. */
  begin?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target, out: ProcOut<G>): ProcReturn<G>;

  /** The payload. None of its procs going off means the cast did not go out (`CastReport.went` is 0). */
  release(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target, out: ProcOut<G>): ProcReturn<G>;

  /** A delivery of this cast caught units (`spells.hit`), all in one call. */
  onHit?(
    this: void,
    ctx: SpellContext<G, Source, Target, State>,
    hit: SpellHit<G, Target>,
    out: ProcOut<G>
  ): ProcReturn<G>;

  /** The cast ended, however it did. */
  onEnd?(
    this: void,
    ctx: SpellContext<G, Source, Target, State>,
    outcome: CastOutcome<G>,
    out: ProcOut<G>
  ): ProcReturn<G>;
}

/** Any spell of a game, whatever its stats, target and state: what a registry holds. */
export type AnySpellDef<G extends SpellTypes> = SpellDef<G>;

/**
 * Fixes a spell's game types and returns the identity that infers the rest from the definition: `const spell =
 * defineSpell<Game>();` then `export const nova = spell({ activation: { kind: 'trigger' }, release: … })`.
 */
export const defineSpell =
  <G extends SpellTypes>() =>
  <const Source extends StatsSource<G> = Readonly<Record<never, never>>, Target = undefined, State = undefined>(
    def: SpellDef<G, Source, Target, State>
  ): SpellDef<G, Source, Target, State> =>
    def;
