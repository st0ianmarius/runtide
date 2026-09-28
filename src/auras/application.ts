import type { StatId, StatView } from '../modifiers/index.ts';
import type { AuraContext } from './active-aura.ts';
import type { AuraStacking } from './aura-def.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';

/** One application of an aura: which aura and what the caller says about it. */
export interface AuraApplication<G extends AuraTypes = AuraTypes> {
  /** The aura applied. */
  readonly aura: AuraId;

  /** Its length in seconds, in place of the definition's. */
  readonly duration?: number;

  /** The stacks it adds (or starts at); `max(1, floor(stacks))`, 1 when absent. */
  readonly stacks?: number;

  /** Its value, merged into the value already there; the definition's `value` when absent. */
  readonly value?: number;

  /** Who applies it (an entity id); with the default credit it becomes the aura's source. */
  readonly source?: number;

  /** A built-in stacking rule for this application only, in place of the definition's. */
  readonly stacking?: Exclude<AuraStacking, 'independent'>;

  /** What the aura's `onLand` hook receives (a damage snapshot, a variant). */
  readonly payload?: G['payload'];
}

/** What an application did (§II.6 A14). */
export interface ApplyResult {
  /** False when it was refused (by the host's policy or a `blockedBy` tag). */
  readonly applied: boolean;

  /** True when it made a fresh instance. */
  readonly fresh: boolean;

  /** True when anything about the aura changed (a losing `highest` changes nothing). */
  readonly changed: boolean;
}

/**
 * What the host's application policy decides (§II.6 A2): refuse, replace the application (substitute another aura,
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

/** A rescale of a bearer's pending activation clocks, handed to the host (§II.6 A13). */
export interface ClockRescale {
  /** The aura whose edge it is. */
  readonly aura: AuraId;

  /** The stat whose multiplier the factor is. */
  readonly stat: StatId;

  /** What the clocks' time left is multiplied by. */
  readonly factor: number;

  /** Whether only pending clocks rescale (else every clock). */
  readonly isPendingOnly: boolean;

  /** The scope whose clocks rescale, or -1 for every clock. */
  readonly scope: number;
}

/**
 * The narrow host an aura system runs against (§I.5): what it cannot do itself. Every member is optional; without
 * one, the matching feature does nothing.
 */
export interface AuraHost<G extends AuraTypes = AuraTypes> {
  /** Runs the procs a hook returned, credited to the aura's source (`ctx.aura.source`). */
  readonly run?: (procs: readonly G['proc'][], ctx: AuraContext<G>) => void;

  /** The bearer's stats, for hook contexts. */
  readonly statsOf?: (bearer: G['bearer']) => StatView | undefined;

  /** The bearer's application policy, asked before anything else; `undefined` accepts the application as it is. */
  readonly onIncomingAura?: (bearer: G['bearer'], application: AuraApplication<G>) => AuraDecision<G> | undefined;

  /** Rescales the bearer's pending activation clocks. */
  readonly rescaleClocks?: (bearer: G['bearer'], rescale: ClockRescale) => void;
}
