import type { AuraId } from '../auras/index.ts';
import type { TickSlotId } from '../core/index.ts';
import type { StatId } from '../modifiers/index.ts';
import type { ProcContext } from '../procs/index.ts';
import type { ClockScale } from './auto.ts';
import type { AutoOptions, CastOptions, CastRefusal, CastReport } from './cast-request.ts';
import type { CasterState } from './caster.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { SpellClock } from './engine.ts';
import type { CastHandle } from './ids.ts';
import type { SpellProcKinds } from './procs.ts';
import type { CastOutcome, SpellContext, SpellHit } from './spell-def.ts';
import type { SpellHost } from './spell-host.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import type { StatsBox } from './stats-box.ts';
import type { CastView } from './view.ts';

/**
 * A spell system: the runner over one game's spells, for any caster. It starts casts in the cast order, runs
 * their hooks' procs credited to them, raises spell events and fires spell cues.
 */
export interface SpellSystem<G extends SpellTypes> {
  /** The game's spells. */
  readonly registry: SpellRegistry<G>;

  /** How many cast records the pool has made, and how many are live: a steady state makes no new ones. */
  readonly pool: {
    /** Records ever made. */
    readonly created: number;

    /** Records live now (running, or ended and still held). */
    readonly live: number;
  };

  /** The proc kinds `castSpell` and `after`: `createProcRegistry({ ...CORE_PROCS, ...spells.procKinds })`. */
  readonly procKinds: SpellProcKinds<G>;

  /** The game's own activation kinds (and core kinds it replaced), in registry order, for the escape report. */
  readonly gameActivations: readonly string[];

  /** The host the system was built with (`SpellSystemBase.host`): read it to check the wiring, never replace it. */
  readonly host: SpellHost<G> & G['host'];

  /** The clock the system was built with (`SpellSystemBase.clock`), read only: for a check that systems share one. */
  readonly clock: SpellClock;

  /** How many tick slots delayed lists land in (the game's `slots`, else 1): an audit walks `delayedStepped` over them. */
  readonly delayedSlots: number;

  /** How many delayed proc lists wait to land, and how many records the pool has made. */
  readonly delayed: {
    /** Lists waiting, over every slot. */
    readonly pending: number;

    /** Records ever made: a steady state makes no new ones. */
    readonly created: number;
  };

  /** A new caster state, for a unit that casts (`SpellCaster.casts`). */
  readonly createCasterState: () => CasterState;

  /**
   * Starts a cast: the gates (the host's `canAct`, the activation kind's), the stats, `canCast`, the target,
   * then `begin`, and the release at once for a spell with no windup. Returns the system's reused report.
   */
  readonly cast: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => CastReport<G>;

  /**
   * Whether a cast would start, asked without starting it: the cast order up to `begin` (the gates, the
   * stats, `canCast`, the target and its reach). The refusal, or `undefined` when it would start. A picker reads it.
   */
  readonly check: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => CastRefusal<G> | undefined;

  /** A spell's cooldown auras (its own, a category's, a global one), in the order it names them. */
  readonly cooldownsOf: (spell: SpellId) => readonly AuraId[];

  /**
   * Whether a caster holds any of a spell's cooldowns, so its casts are refused as `cooldown`: read on the cooldown's
   * `holder` when it names one. A holder is taken as it answers, its life unjudged: the cooldown is what the aura system
   * holds on it, so its death frees every caster only when the aura is `removedOn` that state, and a cast after it
   * lands the aura on whatever unit it answers again; its despawn (`auras.release`) frees them all, and a cast after
   * that lands nothing on it (a released bearer takes no aura), so the casters stay free while it answers that unit.
   */
  readonly isCooling: (caster: G['bearer'], spell: SpellId) => boolean;

  /**
   * The seconds until a caster may cast a spell again: the most left on any of its cooldowns (on their holders); 0 when
   * none runs.
   */
  readonly cooldownLeft: (caster: G['bearer'], spell: SpellId) => number;

  /**
   * Starts every cooldown of a spell on a caster now, each read from the caster's stats for the spell as a cast of it
   * would read them: a press that commits at once, before its cast (which then goes with `committed`). Those that start
   * on the release run that much longer, by its windup, so they end when the cast's own would have.
   */
  readonly startCooldowns: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => void;

  /**
   * Starts every cooldown of a spell as a cast of it starting now would: those that start on the release that much
   * later, by its windup. A prediction mirror, which casts nothing, predicts a button that commits on its cast so.
   */
  readonly predictCooldowns: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => void;

  /** A delivery of a cast caught units: `onHit` with all of them, its cue and event; how many procs went off. */
  readonly hit: (cast: CastHandle, hit: SpellHit<G>) => number;

  /** A live cast's context (running, or ended and still held by its delayed procs); `undefined` when stale. */
  readonly get: (cast: CastHandle) => SpellContext<G> | undefined;

  /** Whether a cast is still in a stage (windup, channel or recover). */
  readonly isRunning: (cast: CastHandle) => boolean;

  /** Whether a caster runs any cast, or a cast of one spell. */
  readonly isCasting: (caster: G['bearer'], spell?: SpellId) => boolean;

  /**
   * Writes a caster's running casts into `out` from index 0, in the order they started, and returns how many. `out`
   * keeps its storage; entries past the count are left as they were.
   */
  readonly castsOf: (caster: G['bearer'], out: CastHandle[]) => number;

  /**
   * Steps every cast a caster runs by one step of the clock, in the order they started: windups count down,
   * track and release, channels beat, recoveries end. The host calls it for each caster in its own order; a paused
   * cast does not count down. A cast started on this tick is not stepped by it, so its stages count from the next
   * tick's step wherever in the tick it was cast (before this step, by a script, an input or a brain stepped first, or
   * after it): a 0.5 s windup at a 0.25 s step cast on tick 0 releases on tick 2 either way. Zero-length stages still
   * pass at the cast itself.
   */
  readonly step: (caster: G['bearer']) => void;

  /**
   * How many times `step` ran for a caster on the clock's current tick: 0 before its first (an end-of-tick audit finds a
   * caster stepped twice or never). Counted on the caster's record, stamped with the tick, so it reads 0 on a new tick.
   */
  readonly stepCount: (caster: G['bearer']) => number;

  /** How many times `stepAuto` ran for a caster on the clock's current tick, counted as `stepCount` counts. */
  readonly autoStepCount: (caster: G['bearer']) => number;

  /**
   * Whether `stepDelayed` ran for a tick slot (the first when absent) on the clock's current tick, landing or not; false
   * for a slot outside the game's (`delayedSlots`).
   */
  readonly delayedStepped: (slot?: TickSlotId) => boolean;

  /**
   * Folds a caster's spell state into `hash` (from `DIGEST_START`, or a digest so far) and returns it: its running
   * casts in start order (each spell, rank, start tick and ordinal, credit, press key, target as an id by the host's
   * `idOf` or a point, stage, ticks left and elapsed in it, stage lengths, pauses, beats, counters and outcome), the
   * tick ordinal its next cast takes, its `auto` clocks (spell, steps left, seconds as set) and the interrupts it holds.
   * Allocates nothing; two games driven alike fold alike, so peers compare it to find the tick they part.
   */
  readonly digest: (caster: G['bearer'], hash: number) => number;

  /**
   * Folds every delayed list waiting to land into `hash` and returns it, in due order (by due tick, then tick slot, then
   * the order they were scheduled): each by its due tick, slot, anchor and offset, owner, origin (self, target, event
   * and other unit by the host's `idOf`, credit), proc count and cast's spell. Allocates nothing once its scratch has
   * grown to the most lists ever waiting.
   */
  readonly digestDelayed: (hash: number) => number;

  /**
   * Whether an interrupt is one the system knows: declared in `interrupts` or named by a spell's timeline, so
   * `interrupt`, `endInterrupt` and `isInterrupted` take it rather than throw. For a wiring check (a unit system's
   * states' interrupts).
   */
  readonly hasInterrupt: (reason: string) => boolean;

  /**
   * Steps a caster's armed `auto` clocks by one step, in registry order: one that ran out casts its spell and
   * is set to what its activation's `next` answers (the interval read at the cast, or sooner). Each cast this step
   * starts goes with `options` (the step's `input`, its credited `source`), as `cast`'s would; with none, no input and
   * the caster's own credit. A clock set or armed earlier on this tick is not stepped by it: it counts from the next
   * tick's step, as one set after this step does. A caster with none armed costs nothing.
   */
  readonly stepAuto: (caster: G['bearer'], options?: AutoOptions<G>) => void;

  /**
   * Arms a caster's `auto` clock for a spell it has now (a template's swing, a card), with `seconds` left counted from
   * the caster's first step after this tick (0: it casts on that step), so a unit steps its own attacks, never the
   * game's; false when armed already.
   */
  readonly arm: (caster: G['bearer'], spell: SpellId, seconds?: number) => boolean;

  /** Disarms a caster's `auto` clock for a spell (the caster lost it); false when it was not armed. */
  readonly disarm: (caster: G['bearer'], spell: SpellId) => boolean;

  /** The seconds left on a caster's `auto` clock for a spell; 0 for one it has not armed. */
  readonly autoClock: (caster: G['bearer'], spell: SpellId) => number;

  /**
   * Sets the seconds left on a caster's armed `auto` clock (a swing reset as another cast ends), counted from the
   * caster's first step after this tick whether set before or after its `stepAuto` this tick; false if unarmed.
   */
  readonly setClock: (caster: G['bearer'], spell: SpellId, seconds: number) => boolean;

  /**
   * Lands every delayed list of a tick slot (the first when absent) due by the clock's tick, in the order they were
   * scheduled, each for its origin as its cast's procs; returns how many landed. The host calls it in its own loop.
   */
  readonly stepDelayed: (slot?: TickSlotId) => number;

  /**
   * Withdraws every delayed list a unit owns that has not landed (an enraged elite's pending
   * volleys), using the owner captured when scheduled. Defaults to the cast's caster or list's self; follow-up
   * delays inherit their parent owner, and `after(seconds, procs, { owner })` overrides it; an unowned list (`owner:
   * 'none'`) is never withdrawn. How many.
   */
  readonly withdrawDelayed: (owner: G['bearer']) => number;

  /** Pauses a running cast: its stage stops counting until `resume`; false for a stale or ended cast. */
  readonly pause: (cast: CastHandle) => boolean;

  /** Resumes a cast `pause` paused (an interrupt's own pause stays until the interrupt ends). */
  readonly resume: (cast: CastHandle) => boolean;

  /** Cancels a running cast: `onEnd` and the end event, with no recovery; false for a stale or ended one. */
  readonly cancel: (cast: CastHandle) => boolean;

  /**
   * Ends a running cast's payload now with an outcome (a charge into a wall ends `blocked`, a lost tether `broken`):
   * no release for a windup, the channel stops, and its recovery follows; false when there is no payload to end.
   */
  readonly finish: (cast: CastHandle, outcome: Exclude<CastOutcome<G>, 'cancelled'>) => boolean;

  /**
   * Moves a running cast's stage end by some seconds: pushback on a hit (later), or a stage cut short (sooner), never
   * below 0 left; its view's end stamp follows. False for a stale or ended cast.
   */
  readonly delay: (cast: CastHandle, seconds: number) => boolean;

  /**
   * An interrupt hits a caster (a stun, a freeze): the caster holds it until as many `endInterrupt` calls as raises, so
   * two overlapping stuns hold it until both end. As it is first raised, each running cast answers it as its timeline
   * says, pausing until it ends or cancelling; returns how many answered (0 for a raise while it is held already, or
   * one no running cast answers). A unit system raises its states' interrupts itself (`units.syncStates`). A cast
   * whose end hooks throw as it cancels leaves the others to answer; the first error is thrown after them, later ones
   * suppressed into it. Throws a `RangeError` for an interrupt the game did not declare (`interrupts`) and no timeline
   * names.
   */
  readonly interrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /**
   * One raise of an interrupt on a caster ends; as its last does, the casts it paused count down again (unless
   * something else pauses them). An end with none held does nothing. Throws a `RangeError` for an interrupt the game
   * did not declare (`interrupts`) and no timeline names.
   */
  readonly endInterrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /**
   * Whether a caster holds an interrupt now (more raises than ends). Throws a `RangeError` for one the game did not
   * declare (`interrupts`) and no timeline names. A cast started while it holds one answers it at once: one that pauses starts
   * paused, and one that cancels is refused (`'interrupted'`).
   */
  readonly isInterrupted: (caster: G['bearer'], reason: G['interrupt']) => boolean;

  /**
   * Cancels every cast a caster runs (its death), in the order they started; how many. One whose end hooks throw is
   * cancelled all the same, as are the casts after it; then the first error is thrown, later ones suppressed into it.
   */
  readonly cancelAll: (caster: G['bearer']) => number;

  /**
   * The cast whose procs are running now (a hook's, a delayed list's), which what they spawn belongs to; or none. It is
   * set while procs run, not in a hook's own body, which has its cast as `ctx.cast` (and names it in a spawn it makes
   * itself).
   */
  readonly current: CastHandle;

  /**
   * The cast a proc list running in `ctx` belongs to (what it spawns and summons is held by): `current`, unless the list
   * is an aura's (its hooks, its triggers), which belongs to no cast, even one landing the aura now. `NO_CAST` for none.
   */
  readonly castFor: (ctx: Pick<ProcContext<G>, 'aura'>) => CastHandle;

  /**
   * Keeps a cast's record alive after it ends (its area triggers and summons live on), until as many
   * `unretain` calls as retains; false for a stale handle.
   */
  readonly retain: (cast: CastHandle) => boolean;

  /** Lets go of one retain; an ended cast nothing retains goes back to the pool. */
  readonly unretain: (cast: CastHandle) => void;

  /**
   * A copy of a `live` cast's stats table for a retainer that must keep reading them as they are now, however later
   * hooks take them again; `undefined` for any other cast, whose `stats` and `scaled` may be held as they are. Give the
   * copy back with `giveStats` once nothing reads it.
   */
  readonly copyStats: (cast: CastHandle) => StatsBox | undefined;

  /** Gives back a copy `copyStats` made; nothing for `undefined`, the copy of a cast that needed none. */
  readonly giveStats: (box: StatsBox | undefined) => void;

  /**
   * Makes a live cast the current one while another system runs its procs as that cast's (an area trigger's hooks),
   * and returns the one it replaced, which `leave` restores.
   */
  readonly enter: (cast: CastHandle) => CastHandle;

  /** Restores the current cast `enter` replaced. */
  readonly leave: (previous: CastHandle) => void;

  /**
   * A spell's share of an outgoing multiplier stat (`SpellDef.scaling`), or `undefined` for a share of 1:
   * what the damage host's `shareOf` answers with (`shareOf: spells.shareOf`).
   */
  readonly shareOf: (spell: SpellId, stat: StatId) => number | undefined;

  /**
   * Rescales a caster's clocks: its `auto` clocks still counting in scope (a spell tag, or every one); a haste aura's
   * hooks call it (or return the `rescaleClocks` proc) as it lands and ends. Returns how many rescaled.
   */
  readonly rescaleClocks: (caster: G['bearer'], rescale: ClockScale) => number;

  /**
   * Fills a running cast's view for the wire into `out` (its spell, stage, stage end stamp, credit and press key);
   * false, leaving `out` alone, for a stale or ended cast.
   */
  readonly viewOf: (cast: CastHandle, out: CastView) => boolean;

  /**
   * The prediction mirror's side of a cast: fires only the spell's mirror-safe cast cue
   * (`SpellCues.cast`) on the caster, with the options' input and key, into the system's cue buffer, and starts no
   * cast. The client notes the event in its echo ring, so the server's copy (same cue, owner and key) is dropped.
   * Returns whether a cue was fired. Throws a `RangeError` for a key given that is not a whole number from 1 (keys count
   * from 1, increase and never wrap).
   */
  readonly predictCast: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => boolean;
}
