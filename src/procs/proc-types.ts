import type { ActiveAura, AuraSystem, AuraTypes } from '../auras/index.ts';
import type { EventKind, Random } from '../core/index.ts';
import type { CueBuffer } from '../cues/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { Proc } from './proc-data.ts';

/**
 * The fields every proc has, whatever its kind: what the runner reads before it hands the proc to its kind. A game's
 * own proc kinds are shaped like this: `{ kind: 'shoot', chance?: 0.5, …its data }`.
 */
export interface ProcShape {
  /** The kind's name in the proc registry: the discriminant, a developer identifier. */
  readonly kind: string;

  /**
   * The odds it goes off. Absent, or 1 and more: always, and nothing is rolled, so an always-proc never shifts a
   * stream. 0 or less: never. In between: one roll on the procs' own stream.
   */
  readonly chance?: number;
}

/**
 * The types one game's procs are written against: the aura types (procs land auras) plus what procs name. A game
 * declares its bundle once, for instance `interface Game extends ProcTypes { readonly proc: Proc<Game>; … }`, so that
 * aura hooks return its procs. Every name here is the game's.
 */
export interface ProcTypes extends AuraTypes {
  /** The names of the game's auras, by which data procs name them before the registry exists (`string` when open). */
  readonly auraName: string;

  /** The names of the game's cues, by which data `cue` procs name them before the registry exists. */
  readonly cueName: string;

  /** The names of the game's resources, which `grant` procs hand out. */
  readonly resource: string;

  /** The names of the random streams a `pickOne` may draw from (the host's stream table). */
  readonly stream: string;

  /** The game's own services, which its proc kinds reach through `ctx.host`. */
  readonly host: unknown;

  /** The data of the game's own proc kinds, as a union (`never` when it has none). */
  readonly gameProc: ProcShape;
}

/**
 * Where a proc lands: `self` (who the procs act for), `target` (the list's default target: a trigger's owner, an aura
 * hook's bearer), `eventUnit` (the unit the event a trigger answers is about), `party` (every unit of the self's
 * party, in the host's order), or a unit itself.
 */
export type ProcTarget<G extends ProcTypes> = 'self' | 'target' | 'eventUnit' | 'party' | G['bearer'];

/**
 * What became of one proc: `skipped` (it did not go off: its chance failed, its list was too deep, its target was
 * already killed by the list, or there was nothing to act on), `refused` (the target turned it away: an immunity, an
 * application policy), and the damage outcomes a pipeline reports (`ignored`, `blocked`, `absorbed`, `landed`,
 * `avoided`).
 */
export type ProcStatus = 'skipped' | 'refused' | 'ignored' | 'blocked' | 'absorbed' | 'landed' | 'avoided';

/** What applying one proc did, which `ctx.apply` returns and the runner reads. */
export interface ProcOutcome {
  /** What became of it. */
  readonly status: ProcStatus;

  /** How much it did (damage dealt, stacks removed); 0 when it counts nothing. */
  readonly amount: number;

  /** Whether it killed its target: later procs of the same list aimed at that unit do nothing. */
  readonly hasKilled: boolean;
}

/** An outcome of a proc that did not go off. */
export const PROC_SKIPPED: ProcOutcome = Object.freeze({ status: 'skipped', amount: 0, hasKilled: false });

/** An outcome of a proc that landed and counts nothing. */
export const PROC_LANDED: ProcOutcome = Object.freeze({ status: 'landed', amount: 0, hasKilled: false });

/** An outcome of a proc its target turned away. */
export const PROC_REFUSED: ProcOutcome = Object.freeze({ status: 'refused', amount: 0, hasKilled: false });

/** Builds an outcome, for a proc kind that reports an amount or a kill; the constants cover the rest. */
export const procOutcome = (
  status: ProcStatus,
  options: {
    /** How much it did. */
    readonly amount?: number;

    /** Whether it killed its target. */
    readonly hasKilled?: boolean;
  } = {},
): ProcOutcome => Object.freeze({ status, amount: options.amount ?? 0, hasKilled: options.hasKilled ?? false });

/**
 * The framework services procs apply through, all optional; the game implements them on its host object, next to its
 * own services (`G['host']`).
 */
export interface ProcHost<G extends ProcTypes> {
  /** The units of `unit`'s party, in party order, `unit` included: what `party` targets and party listeners are. */
  readonly party?: (unit: G['bearer']) => readonly G['bearer'][];

  /** The entity id of a unit, which procs credit as their source; `NO_SOURCE` when absent. */
  readonly idOf?: (unit: G['bearer']) => number;

  /** Hands out an amount of a resource (its id: its position in the system's `resources`) to a unit. */
  readonly grant?: (unit: G['bearer'], resource: number, amount: number) => void;

  /** Where a unit stands now: where a `cue` proc on it sits, unless the proc names a point. */
  readonly positionOf?: (unit: G['bearer']) => Vec2;
}

/**
 * Who a list of procs runs for, as its caller says: a trigger, an aura hook, a spell. Only `self` is required.
 */
export interface ProcOrigin<G extends ProcTypes> {
  /** Who the procs act for: a trigger's owner, an aura's bearer, a caster. */
  readonly self: G['bearer'];

  /** Where a proc naming no target lands; `self` when absent. */
  readonly target?: G['bearer'] | undefined;

  /** The unit the event being answered is about, for `eventUnit` targets. */
  readonly eventUnit?: G['bearer'] | undefined;

  /** The entity id the procs are credited to; the host's id of `self` when absent. */
  readonly source?: number | undefined;

  /** The aura the procs come from (its hook, its trigger), if any. */
  readonly aura?: ActiveAura<G> | undefined;
}

/**
 * What a proc kind applies with, and what `then`, `pickOne` and `run` functions receive. It is reused per nesting
 * level, so a function reads it while it runs and never keeps it. Its functions may be called detached.
 */
export interface ProcContext<G extends ProcTypes> {
  /** Who the procs act for. */
  readonly self: G['bearer'];

  /** Where a proc naming no target lands. */
  readonly target: G['bearer'];

  /** The unit the answered event is about, if any. */
  readonly eventUnit: G['bearer'] | undefined;

  /** The entity id the procs are credited to. */
  readonly source: number;

  /** The aura the procs come from, if any. */
  readonly aura: ActiveAura<G> | undefined;

  /** How many proc lists are running, this one included: 1 for a list run from outside any proc. */
  readonly depth: number;

  /** The aura system procs land auras through. */
  readonly auras: AuraSystem<G>;

  /** The host: the framework services and the game's own. */
  readonly host: ProcHost<G> & G['host'];

  /** The bus `event` procs raise on, if the system has one. */
  readonly bus: ProcBus | undefined;

  /** The buffer `cue` procs fire into, if the system has one: a `run` hatch may fire into it too. */
  readonly cues: CueBuffer | undefined;

  /** A random source: the procs' own stream, or a named stream of the host's table. */
  readonly random: (stream?: G['stream']) => Random;

  /** Applies one proc now, in this list (its kills count for the list), and returns what it did. */
  readonly apply: (proc: Proc<G>) => ProcOutcome;

  /** Runs procs one level deeper, for the same origin: what a delivery or a landed aura sets off. */
  readonly run: (procs: readonly Proc<G>[]) => number;
}

/** The part of a bus the `event` proc raises on (a core `Bus` is one). */
export interface ProcBus {
  /** Whether anything hears a kind. */
  readonly hears: (kind: EventKind<unknown>) => boolean;

  /** The reused payload of a kind. */
  readonly payload: <Payload>(kind: EventKind<Payload>) => Payload;

  /** Raises a filled payload. */
  readonly raise: <Payload>(kind: EventKind<Payload>, payload: Payload) => void;
}
