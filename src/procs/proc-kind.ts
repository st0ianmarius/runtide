import type { AuraId, AuraTagId } from '../auras/index.ts';
import type { Proc } from './proc-data.ts';
import type { ProcContext, ProcOutcome, ProcShape, ProcTarget, ProcTypes } from './proc-types.ts';

/**
 * Turns the names data procs carry into ids, at load (`procs.prepare`) or when a proc naming one applies. Every
 * function throws a `RangeError` naming what it could not find.
 */
export interface ProcResolver<G extends ProcTypes> {
  /** An aura's id, from its name or its id. */
  readonly aura: (aura: G['auraName'] | AuraId) => AuraId;

  /** An aura tag's id, from its name or its id. */
  readonly tag: (tag: G['tag'] | AuraTagId) => AuraTagId;

  /** A resource's id (its position in the system's `resources`), from its name or its id. */
  readonly resource: (resource: G['resource'] | number) => number;

  /** A nested list, prepared the same way (a `group`'s procs). */
  readonly procs: (procs: readonly Proc<G>[]) => readonly Proc<G>[];

  /** Notes a `run` hatch's name for the escape report. */
  readonly hatch: (name: string) => void;
}

/** A proc's own numbers explained as data (§I.5.3), and the procs nested in it. */
export interface ProcDetail<G extends ProcTypes> {
  /** Its numbers by field (`aura`, `stacks`, `duration`, `amount`), ids resolved. */
  readonly values?: Readonly<Record<string, number>>;

  /** The procs it holds (a `group`'s), explained after it. */
  readonly procs?: readonly Proc<G>[];
}

/**
 * One proc kind (§II.3.6): how a proc of it applies, and optionally where it lands, how its names resolve at load,
 * and how it explains itself. A new kind is one of these, one registry line and, if it touches the world, one host
 * method taking its data. Its functions are standalone: the runner may call them detached.
 */
export interface ProcKindDef<P extends ProcShape, G extends ProcTypes> {
  /**
   * Where a proc of this kind lands, for a kind that acts on a unit: the runner resolves it (the list's target when
   * it names none), fans a `party` out over the party in order, and skips a unit its list already killed. Absent
   * for a kind that acts on no unit (a group, a pick, a raised event).
   */
  targetOf?(this: void, proc: P): ProcTarget<G> | undefined;

  /** Applies one proc to its resolved target (`undefined` for a kind with no `targetOf`); `undefined` is `landed`. */
  apply(this: void, proc: P, ctx: ProcContext<G>, target: G['bearer'] | undefined): ProcOutcome | undefined;

  /** Returns the proc with its names resolved to ids, throwing for an unknown one; it is the proc as is when absent. */
  prepare?(this: void, proc: P, resolve: ProcResolver<G>): P;

  /** Its numbers and nested procs, as data; none when absent. */
  explain?(this: void, proc: P, resolve: ProcResolver<G>): ProcDetail<G>;
}

/** A proc of one kind, as `Extract` picks it out of a union. */
interface OfKind<Kind extends string> {
  /** The kind. */
  readonly kind: Kind;
}

/** Every kind of a game's proc union, by name: what `createProcRegistry` takes. */
export type ProcKinds<G extends ProcTypes> = {
  /** The definition of each kind. */
  readonly [Kind in Proc<G>['kind']]: ProcKindDef<Extract<Proc<G>, OfKind<Kind>>, G>;
};

/** Fixes a proc kind's types; returns it unchanged. */
export const defineProcKind = <P extends ProcShape, G extends ProcTypes = ProcTypes>(
  def: ProcKindDef<P, G>,
): ProcKindDef<P, G> => def;
