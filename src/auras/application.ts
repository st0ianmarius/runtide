import type { StatView } from '../modifiers/index.ts';
import type { AuraContext } from './active-aura.ts';
import type { AuraStacking } from './aura-def.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';

/**
 * One application of an aura: which aura and what the caller says about it. A field set to `undefined` counts as
 * absent, so a caller may reuse one application object between calls.
 */
export interface AuraApplication<G extends AuraTypes = AuraTypes> {
  /** The aura applied. */
  readonly aura: AuraId;

  /** Its length in seconds, in place of the definition's. */
  readonly duration?: number | undefined;

  /** The stacks it adds (or starts at); `max(1, floor(stacks))`, 1 when absent. */
  readonly stacks?: number | undefined;

  /** Its value, merged into the value already there; the definition's `value` when absent. */
  readonly value?: number | undefined;

  /** Who applies it (an entity id); with the default credit it becomes the aura's source. */
  readonly source?: number | undefined;

  /** A built-in stacking rule for this application only, in place of the definition's. */
  readonly stacking?: Exclude<AuraStacking, 'independent'> | undefined;

  /** What the aura's `onLand` hook receives (a damage snapshot, a variant). */
  readonly payload?: G['payload'] | undefined;
}

/** What an application did. */
export interface ApplyResult {
  /** False when it was refused (by the host's policy or a `blockedBy` tag). */
  readonly applied: boolean;

  /** True when it made a fresh instance. */
  readonly fresh: boolean;

  /**
   * True when anything about the aura changed: its clock, its stacks or its value. A losing `highest` changes nothing
   * unless its value merge does (the value merges independently of the clock: a strongest-wins slow is `merge: 'max'`).
   */
  readonly changed: boolean;
}

/**
 * What the host's application policy decides: refuse, replace the application (substitute another aura,
 * scale or cap its length, set its magnitude), and apply more after it lands (an immunity window).
 */
export interface AuraDecision<G extends AuraTypes = AuraTypes> {
  /** Whether the application is refused outright; a refusal raises nothing. */
  readonly refuse?: boolean;

  /** The application that lands instead of the incoming one. */
  readonly apply?: AuraApplication<G>;

  /** Applications landed after it, if it lands; the policy does not see them. */
  readonly after?: readonly AuraApplication<G>[];
}

/**
 * The narrow host an aura system runs against: what it cannot do itself. Every member is optional; without
 * one, the matching feature does nothing.
 */
export interface AuraHost<G extends AuraTypes = AuraTypes> {
  /** Runs the procs a hook returned, credited to the aura's source (`ctx.aura.source`). */
  readonly run?: (procs: readonly G['proc'][], ctx: AuraContext<G>) => void;

  /** The bearer's stats, for hook contexts. */
  readonly statsOf?: (bearer: G['bearer']) => StatView | undefined;

  /** The bearer's application policy, asked before anything else; `undefined` accepts the application as it is. */
  readonly onIncomingAura?: (bearer: G['bearer'], application: AuraApplication<G>) => AuraDecision<G> | undefined;

  /**
   * A tagged aura was applied to the bearer, or left it: its tags, and so its derived states, may have
   * changed. Called as the change is dispatched, before the aura's own hook: a unit system raising or ending a stun's
   * interrupt (`units.syncStates`).
   */
  readonly onTagsChanged?: (bearer: G['bearer']) => void;
}
