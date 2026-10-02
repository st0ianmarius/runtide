import type { AuraId } from '../auras/index.ts';
import type { TickSlotId } from '../core/index.ts';
import type { StatId } from '../modifiers/index.ts';
import type { ProcContext } from '../procs/index.ts';
import type { ClockScale } from './auto.ts';
import type { CastOptions, CastRefusal, CastReport } from './cast-request.ts';
import type { CasterState } from './caster.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { CastHandle } from './ids.ts';
import type { SpellProcKinds } from './procs.ts';
import type { CastOutcome, SpellContext, SpellHit } from './spell-def.ts';
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

  /** Whether a caster holds any of a spell's cooldowns, so its casts are refused as `cooldown`. */
  readonly isCooling: (caster: G['bearer'], spell: SpellId) => boolean;

  /** The seconds until a caster may cast a spell again: the most left on any of its cooldowns; 0 when none runs. */
  readonly cooldownLeft: (caster: G['bearer'], spell: SpellId) => number;

  /**
   * Starts every cooldown of a spell on a caster now, each read from the caster's stats for the spell as a cast of it
   * would read them: a press that commits at once, before its cast (which then goes with `committed`).
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
   * cast does not count down.
   */
  readonly step: (caster: G['bearer']) => void;

  /**
   * Steps a caster's armed `auto` clocks by one step, in registry order: one that ran out casts its spell and
   * is set to what its activation's `next` answers (the interval read at the cast, or sooner). A caster with none
   * armed costs nothing.
   */
  readonly stepAuto: (caster: G['bearer']) => void;

  /**
   * Arms a caster's `auto` clock for a spell it has now (a template's swing, a card), with `seconds` left (0: it casts
   * on the next step), so a unit steps its own attacks, never the game's; false when armed already.
   */
  readonly arm: (caster: G['bearer'], spell: SpellId, seconds?: number) => boolean;

  /** Disarms a caster's `auto` clock for a spell (the caster lost it); false when it was not armed. */
  readonly disarm: (caster: G['bearer'], spell: SpellId) => boolean;

  /** The seconds left on a caster's `auto` clock for a spell; 0 for one it has not armed. */
  readonly autoClock: (caster: G['bearer'], spell: SpellId) => number;

  /** Sets the seconds left on a caster's armed `auto` clock (a swing reset as another cast ends); false if unarmed. */
  readonly setClock: (caster: G['bearer'], spell: SpellId, seconds: number) => boolean;

  /**
   * Lands every delayed list of a tick slot (the first when absent) due by the clock's tick, in the order they were
   * scheduled, each for its origin as its cast's procs; returns how many landed. The host calls it in its own loop.
   */
  readonly stepDelayed: (slot?: TickSlotId) => number;

  /**
   * Withdraws every delayed list a unit owns that has not landed (an enraged elite's pending
   * volleys): those its casts scheduled, even casts that ended, and those scheduled for it outside a cast. How many.
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
   * says, pausing until it ends or cancelling; returns how many answered (0 for a raise while it is held already). A
   * unit system raises its states' interrupts itself (`units.syncStates`).
   */
  readonly interrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /**
   * One raise of an interrupt on a caster ends; as its last does, the casts it paused count down again (unless
   * something else pauses them). An end with none held does nothing.
   */
  readonly endInterrupt: (caster: G['bearer'], reason: G['interrupt']) => number;

  /**
   * Whether a caster holds an interrupt now (more raises than ends); false for one the game did not declare
   * (`interrupts`) and no timeline names. A cast started while it holds one answers it at once: one that pauses starts
   * paused, and one that cancels is refused (`'interrupted'`).
   */
  readonly isInterrupted: (caster: G['bearer'], reason: G['interrupt']) => boolean;

  /** Cancels every cast a caster runs (its death), in the order they started; how many. */
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
   * Returns whether a cue was fired.
   */
  readonly predictCast: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => boolean;
}
