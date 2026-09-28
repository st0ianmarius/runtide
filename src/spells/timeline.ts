import type { CastSeconds } from './activation.ts';
import type { ProcOut } from './proc-out.ts';
import type { ProcReturn, SpellContext, StatsSource } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/** What a tracking helper reads of a cast: its stage's clock and a way to re-aim. */
export interface TrackContext<Target> {
  /** The seconds its current stage lasts. */
  readonly stageSeconds: number;

  /** The seconds left in its current stage. */
  readonly remaining: number;

  /** The seconds spent in its current stage. */
  readonly elapsed: number;

  /** Runs the spell's `target` hook again with the cast's input; `undefined` for none. */
  readonly retarget: () => Target | undefined;
}

/**
 * How a cast's aim moves during its windup (§II.3.3): called every step until it answers `'lock'`, after which the aim
 * stays where it is for the rest of the cast. It returns the new target (the old one keeps it still).
 */
export type Track<G extends SpellTypes, Source extends StatsSource<G>, Target, State> = {
  /** Re-aims or locks; declared as a method so a helper over a narrower context still fits. */
  bivarianceHack(ctx: SpellContext<G, Source, Target, State>, target: Target): Target | 'lock';
}['bivarianceHack'];

/**
 * The windup (§II.3.3): the seconds from the cast's start to its release, and how its aim tracks meanwhile.
 */
export interface Windup<G extends SpellTypes, Source extends StatsSource<G>, Target, State> {
  /** Its seconds, read when it starts. */
  readonly seconds: CastSeconds<G, Source>;

  /** How the aim moves until it locks; it locks at the start when absent (and no activation says otherwise). */
  readonly track?: Track<G, Source, Target, State>;

  /** Cancels the cast when true, asked every step of the windup (§II.6 S5: a tether's target lost). */
  cancelIf?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target): boolean;
}

/**
 * The channel (§II.3.3): the payload running over time after the release (a beam, a whirlwind, a charge), ending on
 * its own, by its `breakIf`, or by the game (`spells.finish`).
 */
export interface Channel<G extends SpellTypes, Source extends StatsSource<G>, Target, State> {
  /** Its seconds, read when it starts. */
  readonly seconds: CastSeconds<G, Source>;

  /** The seconds between beats; without it `tick` runs every step. The last beat falls on the channel's last step. */
  readonly every?: number;

  /** A beat: its procs run for the caster. */
  tick?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target, out: ProcOut<G>): ProcReturn<G>;

  /** Ends the cast as `broken` when true, asked every step before the beat (a tether's target out of reach). */
  breakIf?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target): boolean;
}

/** The recovery (§II.3.3): the seconds the caster stays busy after its payload, read with the outcome known. */
export interface Recover<G extends SpellTypes, Source extends StatsSource<G> = StatsSource<G>> {
  /** Its seconds, read when it starts; `ctx.outcome` tells a release from a break (§II.6 S5: a stagger). */
  readonly seconds: CastSeconds<G, Source>;
}

/**
 * How a cast unfolds in time (§II.3.3): a windup, a channel and a recovery, each optional (a spell with none releases
 * at once and ends), the interrupts it answers, and what it does when cancelled. The spell system steps it per caster.
 */
export interface Timeline<G extends SpellTypes, Source extends StatsSource<G>, Target, State> {
  /** Counting to the release. */
  readonly windup?: Windup<G, Source, Target, State>;

  /** The payload running over time, after the release. */
  readonly channel?: Channel<G, Source, Target, State>;

  /** Busy after the payload; a cancelled cast skips it. */
  readonly recover?: Recover<G, Source>;

  /**
   * What each interrupt the game raises does to a running cast (`spells.interrupt`): `pause` (its stage stops counting
   * until the interrupt ends) or `cancel`. An interrupt it does not name leaves it running.
   */
  readonly interrupts?: Readonly<Partial<Record<G['interrupt'], 'pause' | 'cancel'>>>;

  /** The cast was cancelled, before `onEnd` (§II.3.3: withdraw its own unfired telegraphs). */
  onCancel?(this: void, ctx: SpellContext<G, Source, Target, State>, target: Target, out: ProcOut<G>): ProcReturn<G>;
}

/** Tracks the target (through `target` again) until `seconds` before the release, then locks (§II.3.3). */
export const lockBefore =
  (seconds: number) =>
  <Target>(ctx: TrackContext<Target>, target: Target): Target | 'lock' =>
    ctx.remaining <= seconds ? 'lock' : (ctx.retarget() ?? target);

/** Tracks the target until `share` of the windup has passed (0.5: half way), then locks. */
export const lockAtShare =
  (share: number) =>
  <Target>(ctx: TrackContext<Target>, target: Target): Target | 'lock' =>
    ctx.elapsed >= share * ctx.stageSeconds ? 'lock' : (ctx.retarget() ?? target);

/** Locks at once: the aim taken at the start holds. */
export const lockAtStart = <Target>(_ctx: TrackContext<Target>, _target: Target): Target | 'lock' => 'lock';
