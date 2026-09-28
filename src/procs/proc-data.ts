import type { AuraId, AuraTagId } from '../auras/index.ts';
import type { EventKind } from '../core/index.ts';
import type { CueId, CueParamValue } from '../cues/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { ProcContext, ProcShape, ProcTarget, ProcTypes } from './proc-types.ts';

/** Lands an aura (`auras.apply`), credited to the list's source. */
export interface ApplyAuraProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'applyAura';

  /** The aura: its name in data, its id in code. */
  readonly aura: G['auraName'] | AuraId;

  /** Where it lands; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /** Its length in seconds, in place of the aura's own. */
  readonly duration?: number;

  /** The stacks it adds. */
  readonly stacks?: number;

  /** Its value. */
  readonly value?: number;

  /** A built-in stacking rule for this application only. */
  readonly stacking?: 'refresh' | 'extend' | 'stack' | 'highest' | 'keep';

  /** What the aura's `onLand` hook receives. */
  readonly payload?: G['payload'];
}

/** Removes every instance of an aura. */
export interface RemoveAuraProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'removeAura';

  /** The aura: its name in data, its id in code. */
  readonly aura: G['auraName'] | AuraId;

  /** Where it acts; the list's target when absent. */
  readonly to?: ProcTarget<G>;
}

/** A cleanse: removes every aura carrying a tag. */
export interface RemoveByTagProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'removeByTag';

  /** The tag: its name in data, its id in code. */
  readonly tag: G['tag'] | AuraTagId;

  /** Where it acts; the list's target when absent. */
  readonly to?: ProcTarget<G>;
}

/** Hands out a resource through the host (`host.grant`). */
export interface GrantProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'grant';

  /** The resource: its name, or its position in the system's `resources`. */
  readonly resource: G['resource'] | number;

  /** How much. */
  readonly amount: number;

  /** Who receives it; the list's target when absent. */
  readonly to?: ProcTarget<G>;
}

/** Raises an event on the procs' bus: `fill` writes the reused payload, then it is raised (only if heard). */
export interface EventProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'event';

  /** The event kind raised. */
  readonly event: EventKind<unknown>;

  /** Writes the payload; typed per kind by the `raise` builder. */
  fill(this: void, payload: unknown, ctx: ProcContext<G>): void;
}

/**
 * Fires a cue into the proc system's buffer (§II.3.9): presentation only, so it changes nothing and plays even on a
 * unit its list killed. A `self` cue sits on the procs' self and is that unit's; any other sits on `on` (the list's
 * target when absent; `party` fires one per member) or at `at`, and is credited to the list's source (a `world` cue is
 * nobody's). Checked at load (§II.6 P7): a live cue, its own params with values of their kinds, and no `on` or `at`
 * on a `self` cue, no `at` on an `entity` cue.
 */
export interface CueProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'cue';

  /** The cue: its name in data, its id in code. */
  readonly cue: G['cueName'] | CueId;

  /** The unit it sits on, or whose position is its point. */
  readonly on?: ProcTarget<G>;

  /** The point it sits at, in place of a unit's position. */
  readonly at?: Vec2;

  /** Its params by name; a param left out keeps its default. */
  readonly params?: Readonly<Record<string, CueParamValue>>;
}

/** Several procs behind one `chance` (all or nothing), applied in order in the same list. */
export interface GroupProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'group';

  /** The procs, each with its own chance too. */
  readonly procs: readonly Proc<G>[];
}

/**
 * Continues the list with procs decided now, after the procs before it applied (§II.6.1 rule 2): the plan's `then`,
 * named `andThen` so that no registry or module ever has a `then` member (which would make it a thenable).
 */
export interface AndThenProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'andThen';

  /** The procs to apply next, in the same list; `undefined` for none. */
  readonly fn: (ctx: ProcContext<G>) => readonly Proc<G>[] | undefined;
}

/** Picks one unit at random when it applies (after the rolls before it), then continues with procs for it. */
export interface PickOneProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'pickOne';

  /** The candidates, read when it applies; none skips it. */
  readonly from: (ctx: ProcContext<G>) => readonly G['bearer'][];

  /** The stream the pick draws from; the procs' own stream when absent. */
  readonly stream?: G['stream'];

  /** The procs to apply next for the picked unit, in the same list. */
  readonly onPick: (ctx: ProcContext<G>, picked: G['bearer']) => readonly Proc<G>[] | undefined;
}

/**
 * The last-resort escape hatch (§I.5.6 hatch 3): the game's own code, run in place, deterministic by contract (it
 * draws only from `ctx.random` and reads only the simulation). Named, so the escape report counts it.
 */
export interface RunProc<G extends ProcTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'run';

  /** The hatch's developer name (`coil.detect`), for the escape report. */
  readonly hatch: string;

  /** The code. */
  readonly fn: (ctx: ProcContext<G>) => void;
}

/** The framework's own proc kinds, as a union. */
export type CoreProc<G extends ProcTypes> =
  | ApplyAuraProc<G>
  | RemoveAuraProc<G>
  | RemoveByTagProc<G>
  | GrantProc<G>
  | EventProc<G>
  | CueProc<G>
  | GroupProc<G>
  | AndThenProc<G>
  | PickOneProc<G>
  | RunProc<G>;

/** One proc (§II.3.6): a core kind or one of the game's. */
export type Proc<G extends ProcTypes> = CoreProc<G> | G['gameProc'];
