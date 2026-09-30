import { NO_SOURCE } from '../auras/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { StatView } from '../modifiers/index.ts';
import type { ProcOutcome } from '../procs/index.ts';
import type { BlowStatus, DamageKindId, DamageTypes } from './damage-types.ts';

/** No skipped outcome rows or stages. */
const NO_SKIPS: readonly string[] = Object.freeze([]);

/** One stage a traced blow went through (explanations are data): the stage and the amount after it. */
export interface BlowStep {
  /** The stage's developer name (`mitigation`, or a game stage's name). */
  readonly stage: string;

  /** The blow's amount after the stage. */
  readonly amount: number;

  /** The blow's status after the stage: `landed` until a stage ends it. */
  readonly status: BlowStatus;
}

/** What a caller asks the damage pipeline for: one blow on one unit. Only `target` and `amount` are required. */
export interface BlowSpec<G extends DamageTypes> {
  /** Who takes it. */
  readonly target: G['bearer'];

  /** How much, before any stage; a blow of 0, less or NaN is `skipped`. */
  readonly amount: number;

  /** Who deals it: its outgoing multipliers and crit apply, its `onDealt` hooks run; none for the world. */
  readonly attacker?: G['bearer'] | undefined;

  /** The entity id it is credited to; the host's id of the attacker, else `NO_SOURCE`, when absent. */
  readonly source?: number | undefined;

  /** The spell it comes from, whose outgoing-multiplier shares the host looks up. */
  readonly spell?: G['spell'] | undefined;

  /** Its damage kind; the table's first kind when absent. */
  readonly kind?: DamageKindId | undefined;

  /** The point it comes from, for impact and a game's knockback. */
  readonly from?: Vec2 | undefined;

  /** The direction it travels (a projectile's heading, a sideways sweep), for a game's knockback and its cues. */
  readonly direction?: Vec2 | undefined;

  /**
   * The outcome rows it cannot roll, by name: `['block']` for an unblockable blow, `['dodge', 'parry']` for
   * an undodgeable one, `['miss']` for one that cannot miss. None when absent.
   */
  readonly skips?: readonly string[] | undefined;

  /**
   * The stages it skips, by name, beside the ones its kind skips: a spell that ignores armor skips `mitigation`, one
   * that goes through shields skips `absorb`. The after-stages and `health` cannot be skipped. None when absent.
   */
  readonly bypass?: readonly string[] | undefined;

  /**
   * The attacker's stats to read in place of its live ones: a snapshot taken as a damage over time was cast, so its
   * ticks keep the multipliers and crit they had (even once the caster is gone). The live ones when absent.
   */
  readonly attackerStats?: StatView | undefined;

  /** The game's own fields for this blow. */
  readonly ext?: G['blowExt'] | undefined;

  /** An array each stage appends a step to, for explaining this blow; nothing is recorded when absent. */
  readonly trace?: BlowStep[] | undefined;
}

/**
 * A blow as stages, hooks, events and callers see it: what it was asked to be, what each stage
 * made of it, and, once the pipeline is done, how it ended. It is reused per nesting level, so nothing keeps it past
 * the call that handed it over. It is a proc outcome too: a damage proc reports it as is.
 */
export interface Blow<G extends DamageTypes> extends ProcOutcome {
  /** Who takes it. */
  readonly target: G['bearer'];

  /** Who deals it, if anyone. */
  readonly attacker: G['bearer'] | undefined;

  /** The entity id it is credited to. */
  readonly source: number;

  /** The spell it comes from, if any. */
  readonly spell: G['spell'] | undefined;

  /** Its damage kind. */
  readonly kind: DamageKindId;

  /** The amount it was asked for. */
  readonly base: number;

  /**
   * The damage it carries now. Once it is done: what reached health, 0 when it was skipped, ignored, blocked or fully
   * absorbed, or when a death was prevented.
   */
  readonly amount: number;

  /** The point it comes from, if given. */
  readonly from: Vec2 | undefined;

  /** The direction it travels, if given. */
  readonly direction: Vec2 | undefined;

  /** The outcome rows it cannot roll. */
  readonly skips: readonly string[];

  /** The stages it skips beside its kind's. */
  readonly bypass: readonly string[];

  /** The attacker's stats it reads in place of the live ones, if any. */
  readonly attackerStats: StatView | undefined;

  /** The outcome row it rolled that decided or changed it (`dodge`, `block`, `crit`); `undefined` for none. */
  readonly outcome: string | undefined;

  /** Whether the crit stage made it critical. */
  readonly isCrit: boolean;

  /** What the mitigation rows took off it (negative when a row amplified it). */
  readonly mitigated: number;

  /** What absorbs took out of it. */
  readonly absorbed: number;

  /** The damage a prevented death did not deal. */
  readonly prevented: number;

  /** How it ended; `landed` while it runs, until a stage ends it. */
  readonly status: BlowStatus;

  /** The target's health when the health stage ran (0 before it). */
  readonly healthBefore: number;

  /** The target's health after the health stage (0 before it). */
  readonly healthAfter: number;

  /** The health it took, capped at the health there was: `min(amount, healthBefore)`, so overkill is left out. */
  readonly dealt: number;

  /** Whether it killed the target. */
  readonly hasKilled: boolean;

  /** Whether an `onLethal` hook prevented the death it would have dealt. */
  readonly isDeathPrevented: boolean;

  /** The game's own fields, as the spec gave them. */
  readonly ext: G['blowExt'] | undefined;
}

/** The mutable record behind a `Blow`, one per nesting level, which built-in and game stages write. */
export class BlowRecord<G extends DamageTypes> implements Blow<G> {
  target: G['bearer'];
  attacker: G['bearer'] | undefined = undefined;
  source = NO_SOURCE;
  spell: G['spell'] | undefined = undefined;
  kind: DamageKindId;
  base = 0;
  amount = 0;
  from: Vec2 | undefined = undefined;
  direction: Vec2 | undefined = undefined;
  skips: readonly string[] = NO_SKIPS;
  bypass: readonly string[] = NO_SKIPS;
  attackerStats: StatView | undefined = undefined;
  outcome: string | undefined = undefined;
  isCrit = false;
  mitigated = 0;
  absorbed = 0;
  prevented = 0;
  status: BlowStatus = 'landed';
  healthBefore = 0;
  healthAfter = 0;
  dealt = 0;
  hasKilled = false;
  isDeathPrevented = false;
  ext: G['blowExt'] | undefined = undefined;

  /** Where steps are recorded, if the blow is traced. */
  trace: BlowStep[] | undefined = undefined;

  constructor(target: G['bearer'], kind: DamageKindId) {
    this.target = target;
    this.kind = kind;
  }

  /** Fills the record from a spec, every field reset. */
  reset(spec: BlowSpec<G>, parts: { readonly source: number; readonly kind: DamageKindId }): void {
    this.target = spec.target;
    this.attacker = spec.attacker;
    this.source = parts.source;
    this.spell = spec.spell;
    this.kind = parts.kind;
    this.base = spec.amount;
    this.amount = spec.amount;
    this.from = spec.from;
    this.direction = spec.direction;
    this.skips = spec.skips ?? NO_SKIPS;
    this.bypass = spec.bypass ?? NO_SKIPS;
    this.attackerStats = spec.attackerStats;
    this.ext = spec.ext;
    this.trace = spec.trace;
    this.clearOutcome();
  }

  /** Clears what the stages decide. */
  clearOutcome(): void {
    this.isCrit = false;
    this.outcome = undefined;
    this.mitigated = 0;
    this.absorbed = 0;
    this.prevented = 0;
    this.status = 'landed';
    this.healthBefore = 0;
    this.healthAfter = 0;
    this.dealt = 0;
    this.hasKilled = false;
    this.isDeathPrevented = false;
  }
}
