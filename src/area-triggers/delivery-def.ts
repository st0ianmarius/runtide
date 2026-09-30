import type { AuraId } from '../auras/index.ts';
import type { Shape } from '../math/index.ts';
import type { ProcOut, ProcReturn, SpellHit } from '../spells/index.ts';
import type { QuerySide } from '../world/index.ts';
import type { AreaFn, AreaTriggerContext } from './area-def.ts';
import type { AreaTriggerTypes } from './area-types.ts';

/**
 * A hit ledger as a hook sees it: who was hit and how often, under its kind's policy. Shared per area trigger or
 * per cast, as its spec says.
 */
export interface AreaLedger<Unit> {
  /** How many different units it recorded. */
  readonly distinct: number;

  /** How many hits it recorded, repeats included. */
  readonly hits: number;

  /** Whether its pierce or budget ran out: every catch through it now catches nothing. */
  readonly isSpent: boolean;

  /** Whether it recorded a hit on the unit. */
  readonly has: (unit: Unit) => boolean;

  /** The share a hit on the unit would take now under its policy, 0 when refused; records nothing. */
  readonly shareOf: (unit: Unit) => number;

  /** Records a hit on the unit and returns its share, or records nothing and returns 0 when its policy refuses it. */
  readonly record: (unit: Unit) => number;
}

/**
 * A hit ledger's rules: `once` (each unit once: once-per-cast in the cast's scope),
 * `repeat` (every hit, a repeat taking `share`: repeat-share), or `rehit` (again after `cooldown` seconds:
 * rehit-cooldown); with an optional
 * `pierce` (different units) and `budget` (hits) after which it is spent.
 */
export interface AreaLedgerSpec {
  /** Which hits it lets through. */
  readonly policy: 'once' | 'repeat' | 'rehit';

  /** Who shares it: each area trigger its own (`self`, the default), or every area trigger of its cast. */
  readonly scope?: 'self' | 'cast';

  /** The share a repeat hit takes under `repeat`, from 0 to 1; 1 by default. */
  readonly share?: number;

  /** The seconds before a unit can be hit again under `rehit`. */
  readonly cooldown?: number;

  /** The most different units it lets through; it is spent after them. */
  readonly pierce?: number;

  /** The most hits it lets through, repeats included; it is spent after them. */
  readonly budget?: number;
}

/**
 * What a delivery of an area trigger caught, handed to `onContact`, `onPulse` and `onLand` in one call:
 * every unit, in the world's order (a sweep's in the order it reached them), at its position and in its shape. It is a
 * spell hit, so it is the cast's hit too when the kind says so (`hitsCast`). Reused: read it, never keep it.
 */
export interface AreaHit<G extends AreaTriggerTypes> extends SpellHit<G> {
  /** Each unit's share of the hit, in the order of `targets`: 1 for a full hit (the hit ledgers lower it). */
  readonly shares: readonly number[];

  /** The pulse that caught them (its index in `every`), or -1 for a contact or a landing. */
  readonly pulse: number;
}

/** Which units a delivery catches: a side relative to the owner, a condition, and the ledger it records in. */
export interface AreaCatch<G extends AreaTriggerTypes, State = unknown> {
  /** Which side, relative to its owner; `foes` by default. */
  readonly side?: QuerySide;

  /** The hit ledger it records in and is filtered by, by name; none (every catch lands whole) when absent. */
  readonly ledger?: string;

  /** A condition a unit must meet (line of sight from it, not branded yet). */
  unitFilter?(this: void, c: AreaTriggerContext<G, State>, unit: G['bearer']): boolean;
}

/** Its swept contacts along its move (missiles, blades, waves): its body's radius and whom it may reach. */
export interface AreaContact<G extends AreaTriggerTypes, State = unknown> extends AreaCatch<G, State> {
  /** Its body's radius, around its position; a function read at each frame. */
  readonly radius: number | AreaFn<G, State, number>;
}

/**
 * A pulse: a beat on the area trigger's own clock that catches the units in its shape and hands them to `onPulse`. A
 * clock several instances share (an owner's patches) is the game's: one owner-attached area trigger whose pulse reads
 * the others through `c.areas`.
 */
export interface AreaPulse<G extends AreaTriggerTypes, State = unknown> extends AreaCatch<G, State> {
  /** The seconds between beats: a number, or read from its stats at every reschedule. */
  readonly seconds: number | AreaFn<G, State, number>;

  /** The seconds to its first beat; `seconds` by default. */
  readonly first?: number;

  /**
   * How the next beat is set: by cadence (the default: the previous beat plus the seconds, so the leftover carries), or
   * by restart (now plus the seconds).
   */
  readonly reschedule?: 'cadence' | 'restart';

  /** Whether a step behind by several beats runs them all (true, the default) or one. */
  readonly catchUp?: boolean;

  /** What it catches: the units in its placed shape (the default), in a shape of its own (relative to it), or none. */
  readonly hits?: Shape | 'none';

  /** The beat: what it does to the units caught (none, when it catches none). */
  onPulse(this: void, c: AreaTriggerContext<G, State>, hit: AreaHit<G>, out: ProcOut<G>): ProcReturn<G>;
}

/**
 * An aura an area trigger keeps on the units in its shape: put on as a unit enters, for the aura's own length, and
 * taken off as it leaves (overlapping area triggers counted, so the last one left takes it off), or left with `linger`
 * seconds, so it lingers after the unit leaves. The units are caught as the area trigger's `auras` part runs, in its
 * shape, and only the units that entered or left since the last frame are touched.
 */
export interface AreaAura<G extends AreaTriggerTypes, State = unknown> extends Omit<AreaCatch<G, State>, 'ledger'> {
  /** The aura: its name in data, its id in code. */
  readonly aura: G['auraName'] | AuraId;

  /** The seconds it is left with as the last area trigger holding it lets a unit go; taken off at once when absent. */
  readonly linger?: number;

  /** The stacks each application adds. */
  readonly stacks?: number;

  /** The value each application carries. */
  readonly value?: number;

  /**
   * How often it catches and compares, in seconds: a unit's entry or exit is noticed up to this late, and the frames
   * between cost nothing (a slowing field in a crowd). Every frame when absent.
   */
  readonly every?: number;
}

/** A part of an area trigger's frame, in the order `order` runs them. */
export type AreaPhase = 'move' | 'contact' | 'frame' | 'pulses' | 'auras';
