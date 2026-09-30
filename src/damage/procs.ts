import type { Vec2 } from '../math/index.ts';
import type { ScaledSnapshot, StatId } from '../modifiers/index.ts';
import type { Proc, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { BlowStatus, DamageKindId, DamageTypes, ForceKind } from './damage-types.ts';

/** The damage part of a damage or heal proc: a number, or a scaled value's snapshot finished against each target. */
export type ProcAmount = number | ScaledSnapshot;

/**
 * Deals a blow through the damage pipeline, credited to the list's source. Its attacker is the unit the list
 * is credited to: `self` when the list's source is `self`'s own id (a trigger, a spell), else the host's `unitOf`
 * the source (a periodic beat on its victim, credited to its caster); `attacker: 'none'` deals it as the world's.
 */
export interface DamageProc<G extends DamageTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'damage';

  /** How much: a number, or a snapshot whose target terms are finished against the target at the hit. */
  readonly amount: ProcAmount;

  /** Where it lands; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /** Its damage kind: the name in data, the id in code; the table's first kind when absent. */
  readonly damageKind?: G['damageKind'] | DamageKindId;

  /** Whether it has the credited attacker (the default) or none. */
  readonly attacker?: 'credited' | 'none';

  /** The spell it comes from, whose outgoing-multiplier shares apply. */
  readonly spell?: G['spell'];

  /** The point it comes from. */
  readonly from?: Vec2;

  /** The direction it travels (a projectile's heading), which the blow carries. */
  readonly direction?: Vec2;

  /** The game's own fields on its blow (`blow.ext`: a crushing share, a hit window's key), which its stages read. */
  readonly ext?: G['blowExt'];

  /** The outcome rows it cannot roll (`['block']`: unblockable), by name. */
  readonly skips?: readonly string[];

  /**
   * Procs that follow it in the same list when the blow ends with a status of `on` (the frost nova's slow
   * lands only if the hit did), aimed at the blow's target, after its kill is noted.
   */
  readonly andThen?: readonly Proc<G>[];

  /** The statuses `andThen` follows; `landed` when absent. */
  readonly on?: BlowStatus | readonly BlowStatus[];
}

/** Heals through the heal pipeline, credited like a damage proc (the healer is the credited unit). */
export interface HealProc<G extends DamageTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'heal';

  /** How much, or a share of the target's stat `of`. */
  readonly amount: ProcAmount;

  /** A stat of the target the amount is a share of (`heal(0.2, { of: 'maxHealth' })`). */
  readonly of?: G['stat'] | StatId;

  /** Where it lands; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /** The spell it comes from. */
  readonly spell?: G['spell'];
}

/** Sets health outright, bypassing the heal stages: a death escape's heal back to a share. */
export interface SetHealthProc<G extends DamageTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'setHealth';

  /** The new health, or a share of the target's maximum health. */
  readonly health:
    | number
    | {
        /** The share. */
        readonly share: number;
      };

  /** Where it lands; the list's target when absent. */
  readonly to?: ProcTarget<G>;
}

/**
 * Moves the unit it lands on through the force pipeline: a push along a direction, a pull toward a
 * point, a knock away from one, or one of the game's forces. The list's self causes it (a pull or knock without a
 * `from` comes from where the host sees it stand); the host's `applyForce` moves the unit.
 */
export interface ForceProc<G extends DamageTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'force';

  /** What force it is. */
  readonly force: ForceKind<G>;

  /** How hard, above 0. */
  readonly strength: number;

  /** Whom; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /** The point it comes from (a pull toward it, a knock away from it). */
  readonly from?: Vec2;

  /** Its direction (a push's). */
  readonly direction?: Vec2;
}

/** The damage system's proc kinds, as a union a game adds to its `gameProc`. */
export type DamageProcs<G extends DamageTypes> = DamageProc<G> | HealProc<G> | SetHealthProc<G> | ForceProc<G>;

/** The damage system's proc kinds (`damage`, `heal`, `setHealth`, `force`), which a game registers beside `CORE_PROCS`. */
export interface DamageProcKinds<G extends DamageTypes> {
  /** Deals a blow. */
  readonly damage: ProcKindDef<DamageProc<G>, G>;

  /** Heals. */
  readonly heal: ProcKindDef<HealProc<G>, G>;

  /** Sets health. */
  readonly setHealth: ProcKindDef<SetHealthProc<G>, G>;

  /** Pushes, pulls or knocks. */
  readonly force: ProcKindDef<ForceProc<G>, G>;
}

/** A `damage` proc: `damage(40, { damageKind: 'fire', andThen: [applyAura('chilled')] })`. */
export const damage = <G extends DamageTypes = DamageTypes>(
  amount: ProcAmount,
  options: Omit<DamageProc<G>, 'kind' | 'amount'> = {},
): DamageProc<G> => ({ ...options, kind: 'damage', amount });

/** A `heal` proc: `heal(25)`, or `heal(0.2, { of: 'maxHealth' })`. */
export const heal = <G extends DamageTypes = DamageTypes>(
  amount: ProcAmount,
  options: Omit<HealProc<G>, 'kind' | 'amount'> = {},
): HealProc<G> => ({ ...options, kind: 'heal', amount });

/** A `setHealth` proc: `setHealth({ share: 0.3 })`. */
export const setHealth = <G extends DamageTypes = DamageTypes>(
  health: SetHealthProc<G>['health'],
  options: Omit<SetHealthProc<G>, 'kind' | 'health'> = {},
): SetHealthProc<G> => ({ ...options, kind: 'setHealth', health });

/** A push along a direction: `push(3, { direction })`, or away from a point the game's `applyForce` reads. */
export const push = <G extends DamageTypes = DamageTypes>(
  strength: number,
  options: Omit<ForceProc<G>, 'kind' | 'force' | 'strength'> = {},
): ForceProc<G> => ({ ...options, kind: 'force', force: 'push', strength });

/** A pull toward a point, or toward the list's self when the proc names none: `pull(2)`. */
export const pull = <G extends DamageTypes = DamageTypes>(
  strength: number,
  options: Omit<ForceProc<G>, 'kind' | 'force' | 'strength'> = {},
): ForceProc<G> => ({ ...options, kind: 'force', force: 'pull', strength });
