import { type CastHandle, NO_CAST } from './ids.ts';
import type { ReachRefusal } from './reach.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/**
 * Why a cast was refused: a gate's own reason (the game's), a plain false from the gates (the host's `canAct`, the
 * activation kind's) or from `canCast`, one of its cooldowns, no target, or a reach rule (the target out of `range`,
 * too `close`, out of `sight`, or refused by the reach's own `allows` as `reach`).
 */
export type CastRefusal<G extends SpellTypes = SpellTypes> =
  | 'gate'
  | 'canCast'
  | 'interrupted'
  | 'cooldown'
  | 'target'
  | ReachRefusal
  | G['refusal'];

/**
 * What a gate answers: true (or nothing) lets the cast on, false refuses it for the gate's default reason, and one of
 * the game's reasons refuses it for that reason.
 */
export type GateAnswer<G extends SpellTypes> = boolean | G['refusal'];

/** What starting a cast did (`spells.cast`), reused between calls, so read it at once. */
export interface CastReport<G extends SpellTypes = SpellTypes> {
  /** The cast's handle; stale at once for a cast that ended within the call; `NO_CAST` for a refusal. */
  readonly handle: CastHandle;

  /** `refused`, `running` (in a stage), or `ended` (it ran its whole course within the call). */
  readonly status: 'refused' | 'running' | 'ended';

  /** Why it was refused; `undefined` when it started. */
  readonly refusal: CastRefusal<G> | undefined;

  /** How many of its release procs went off; 0 when it has not released yet (or was refused). */
  readonly went: number;

  /** Whether its payload went out within the call (a spell with no windup), whatever its procs did. */
  readonly hasReleased: boolean;
}

/**
 * What a caster's `auto` casts are started with in one step (`spells.stepAuto`): the step's aim or target (`input`: a
 * twin-stick hero's aim, an MMO swing's target) and whom their hits credit (`source`: a pet's owner).
 */
export type AutoOptions<G extends SpellTypes> = Pick<CastOptions<G>, 'input' | 'source'>;

/** Stage durations for one cast, in finite seconds from 0; omitted stages keep the spell's authored duration. */
export interface CastStages {
  /** Seconds before release. */
  readonly windup?: number | undefined;

  /** Seconds spent channeling after release. */
  readonly channel?: number | undefined;

  /** Seconds spent recovering after the payload. */
  readonly recover?: number | undefined;
}

/** How a cast is started, beyond the caster and the spell. */
export interface CastOptions<G extends SpellTypes> {
  /** What the activation hands it: an aim, a unit (`ctx.input`, the `target` hook's argument). */
  readonly input?: G['input'] | undefined;

  /** Its rank, from 1; the caster's own (`host.rankOf`), else 1, when absent. */
  readonly rank?: number | undefined;

  /** The entity id its hits are credited to; the caster's (`host.idOf`) when absent. */
  readonly source?: number | undefined;

  /**
   * The key its predicted cast cue carries: the game's press key (its input sequence), the same on the
   * server and the predicting client; 0 (none) when absent.
   */
  readonly key?: number | undefined;

  /**
   * Whether its cooldowns already started (`spells.startCooldowns`: a press that committed at once): the cast neither
   * refuses on them nor lands them again. False when absent.
   */
  readonly committed?: boolean | undefined;

  /** Skips checking and starting the spell's cooldowns; all other cast checks still apply. False when absent. */
  readonly ignoreCooldown?: boolean | undefined;

  /** Duration overrides captured for this cast; stage hooks, tracking, beats and interrupts still use the spell. */
  readonly stages?: CastStages | undefined;
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
export class Report<G extends SpellTypes = SpellTypes> implements CastReport<G> {
  handle: CastHandle = NO_CAST;
  status: CastReport['status'] = 'refused';
  refusal: CastRefusal<G> | undefined = undefined;
  went = 0;
  hasReleased = false;

  /**
   * For an `auto` spell, its interval read at the cast, with the cast's stats (taken for a refusal at the
   * gate too, when the interval reads them); NaN for any other spell. The auto clock's own: not on the public report.
   */
  interval = Number.NaN;
}

/** The request a system reuses for every cast. */
export class MutableRequest<G extends SpellTypes> implements CastRequest<G> {
  caster: G['bearer'];
  spell: SpellId;
  options: CastOptions<G> = NO_OPTIONS;

  constructor(caster: G['bearer'], spell: SpellId) {
    this.caster = caster;
    this.spell = spell;
  }
}
