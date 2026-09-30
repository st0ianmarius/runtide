import type { AuraContext } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';

/**
 * What an `onIncomingDamage` hook does to a blow (WoW's absorb and damage-taken aura effects). The damage pipeline
 * applies the changes of each aura in registry order.
 */
export interface BlowChange {
  /** Damage this aura takes out of the blow (an absorb spends its `value` by the same amount). */
  readonly absorb?: number;

  /** A factor the remaining damage is multiplied by. */
  readonly scale?: number;
}

/** What an `onOutgoingDamage` hook does to a blow its bearer deals. */
export interface OutgoingChange {
  /** A factor the blow's damage is multiplied by (more against a stunned target, less on a glancing swing). */
  readonly scale?: number;
}

/** What an `onIncomingForce` hook does to a knockback, push or pull. */
export interface ForceChange {
  /** A factor the force's strength is multiplied by. */
  readonly scale?: number;

  /** Whether the force is cancelled outright. */
  readonly isCancelled?: boolean;
}

/** What an `onLethal` hook answers when it prevents a death (WoW's prevent-death aura effect). */
export interface LethalOutcome<Proc> {
  /** Always true: the death is prevented. */
  readonly prevent: true;

  /** The procs that follow (a heal back to a share of health, an escape window). */
  readonly procs: readonly Proc[];
}

/**
 * The damage pipeline's aura hooks: before a blow lands on a bearer, each of its auras with a hook sees it,
 * in registry order. They are declared here and built into the registry's hook tables; the damage system's pipelines
 * call them.
 */
export interface AuraDamageHooks<G extends AuraTypes> {
  /** The ignore stage: true lets the blow pass the bearer by (invulnerability, shelter, an immunity). */
  readonly onIgnore?: (ctx: AuraContext<G>, blow: G['blow']) => boolean;

  /**
   * The attacker side of the outgoing stage, after the bearer's outgoing multipliers: changes a blow it deals (a bonus
   * against a marked target, which no stat can say), or `undefined` to leave it alone.
   */
  readonly onOutgoingDamage?: (ctx: AuraContext<G>, blow: G['blow']) => OutgoingChange | undefined;

  /** The absorb stage: changes the blow, or `undefined` to leave it alone. */
  readonly onIncomingDamage?: (ctx: AuraContext<G>, blow: G['blow']) => BlowChange | undefined;

  /** The lethal stage: prevents the death, or `undefined` to let it happen. It runs for true damage too. */
  readonly onLethal?: (ctx: AuraContext<G>, blow: G['blow']) => LethalOutcome<G['proc']> | undefined;

  /** The attacker side: procs after the bearer dealt a blow (lifesteal spending the aura's value). */
  readonly onDealt?: (ctx: AuraContext<G>, blow: G['blow']) => readonly G['proc'][] | undefined;

  /** The force stage: changes a knockback, push or pull, or `undefined` to leave it alone. */
  readonly onIncomingForce?: (ctx: AuraContext<G>, force: G['force']) => ForceChange | undefined;
}
