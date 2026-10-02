import { NO_SOURCE } from '../auras/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { ProcOutcome } from '../procs/index.ts';
import type { Blow } from './blow.ts';
import type { DamageTypes, ForceKind, ForceStatus } from './damage-types.ts';

/** What a caller asks the force pipeline for: a knockback, push or pull on one unit. */
export interface ForceSpec<G extends DamageTypes> {
  /** Who is moved. */
  readonly target: G['bearer'];

  /** How hard, before any stage; 0, less, NaN or infinite is `skipped`. */
  readonly strength: number;

  /** What it is; `knock` when absent. */
  readonly kind?: ForceKind<G> | undefined;

  /** Who causes it, if anyone. */
  readonly attacker?: G['bearer'] | undefined;

  /** The entity id it is credited to; the host's id of the attacker, else `NO_SOURCE`, when absent. */
  readonly source?: number | undefined;

  /** The point it comes from (a knock goes away from it, a pull toward it). */
  readonly from?: Vec2 | undefined;

  /** The direction of a push, when it has one of its own. */
  readonly direction?: Vec2 | undefined;

  /** The blow whose knockback it is, when a blow caused it. */
  readonly blow?: Blow<G> | undefined;
}

/**
 * A force as its stages, the `onIncomingForce` hooks and the host see it. It is reused per nesting level, so nothing
 * keeps it past the call that handed it over. The host's `applyForce` moves the unit with it; the physics are the
 * game's.
 */
export interface Force<G extends DamageTypes> extends ProcOutcome {
  /** Who is moved. */
  readonly target: G['bearer'];

  /** Who causes it, if anyone. */
  readonly attacker: G['bearer'] | undefined;

  /** The entity id it is credited to. */
  readonly source: number;

  /** What it is. */
  readonly kind: ForceKind<G>;

  /** The strength it was asked for. */
  readonly base: number;

  /** The strength it has now; once done, what was applied (0 when skipped or cancelled). */
  readonly amount: number;

  /** The point it comes from, if given. */
  readonly from: Vec2 | undefined;

  /** Its own direction, if given. */
  readonly direction: Vec2 | undefined;

  /** The blow whose knockback it is (read while the force runs: the blow is reused after), if a blow caused it. */
  readonly blow: Blow<G> | undefined;

  /** How it ended; `landed` while it runs. */
  readonly status: ForceStatus;
}

/** The mutable record behind a `Force`, one per nesting level. */
export class ForceRecord<G extends DamageTypes> implements Force<G> {
  target: G['bearer'];
  attacker: G['bearer'] | undefined = undefined;
  source = NO_SOURCE;
  kind: ForceKind<G> = 'knock';
  base = 0;
  amount = 0;
  from: Vec2 | undefined = undefined;
  direction: Vec2 | undefined = undefined;
  blow: Blow<G> | undefined = undefined;
  status: ForceStatus = 'landed';
  readonly hasKilled = false;

  constructor(target: G['bearer']) {
    this.target = target;
  }

  /** Fills the record from a spec. */
  reset(spec: ForceSpec<G>, source: number): void {
    this.target = spec.target;
    this.attacker = spec.attacker;
    this.source = source;
    this.kind = spec.kind ?? 'knock';
    this.base = spec.strength;
    this.amount = spec.strength;
    this.from = spec.from;
    this.direction = spec.direction;
    this.blow = spec.blow;
    this.status = 'landed';
  }
}
