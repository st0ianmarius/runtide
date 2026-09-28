import type { AuraId } from '../auras/index.ts';
import type { Shape } from '../math/index.ts';
import type { ProcOut, ProcReturn, SpellHit, SpellId } from '../spells/index.ts';
import type { QuerySide } from '../world/index.ts';
import type { AreaFn, AreaTriggerContext } from './area-def.ts';
import type { AreaTriggerTypes } from './area-types.ts';

/**
 * A hit ledger as a hook sees it (§II.6 W3): who was hit, how often, and who holds a claim, under its kind's policy.
 * Shared per area trigger, per cast or per family, as its spec says.
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

  /** Claims the unit for this area trigger (a glaive's reservation); false when another member holds it. */
  readonly reserve: (unit: Unit) => boolean;

  /** Whether another member of the ledger holds a claim on the unit. */
  readonly isClaimed: (unit: Unit) => boolean;
}

/**
 * A hit ledger's rules (§II.3.4's hit policies, §II.6 W3): `once` (each unit once: once-per-cast in the cast's scope),
 * `repeat` (every hit, a repeat taking `share`: repeat-share), `rehit` (again after `cooldown` seconds:
 * rehit-cooldown) or `claim` (a unit hit by one member is that member's alone until it ends); with an optional
 * `pierce` (different units) and `budget` (hits) after which it is spent.
 */
export interface AreaLedgerSpec {
  /** Which hits it lets through. */
  readonly policy: 'once' | 'repeat' | 'rehit' | 'claim';

  /** Who shares it: each area trigger its own (`self`, the default), every area trigger of its cast, or its family. */
  readonly scope?: 'self' | 'cast' | 'family';

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
 * What a delivery of an area trigger caught (§II.3.4), handed to `onContact`, `onPulse` and `onLand` in one call:
 * every unit, in the world's order (a sweep's in the order it reached them), at its position and in its shape. It is a
 * spell hit, so it is the cast's hit too when the kind says so (`hitsCast`). Reused: read it, never keep it.
 */
export interface AreaHit<G extends AreaTriggerTypes> extends SpellHit<G> {
  /** Each unit's share of the hit, in the order of `targets`: 1 for a full hit (§II.6 W3's ledgers lower it). */
  readonly shares: readonly number[];

  /** The pulse that caught them (its index in `every`), or -1 for a contact or a landing. */
  readonly pulse: number;
}

/** Which units a delivery catches: a side relative to the owner, a condition, and the ledger it records in. */
export interface AreaCatch<G extends AreaTriggerTypes, State = unknown> {
  /** Which side, relative to its owner; `foes` by default. */
  readonly side?: QuerySide;

  /** The hit ledger it records in and is filtered by (§II.6 W3), by name; none (every catch lands whole) when absent. */
  readonly ledger?: string;

  /** A condition a unit must meet (line of sight from it, not branded yet). */
  unitFilter?(this: void, c: AreaTriggerContext<G, State>, unit: G['bearer']): boolean;
}

/** Its swept contacts along its move (§II.3.4: missiles, blades, waves): its body's radius and whom it may reach. */
export interface AreaContact<G extends AreaTriggerTypes, State = unknown> extends AreaCatch<G, State> {
  /** Its body's radius, around its position; a function read at each frame. */
  readonly radius: number | AreaFn<G, State, number>;
}

/**
 * A pulse (§II.3.4, §II.6 W2): a beat on a clock that catches the units in its shape and hands them to `onPulse`. Its
 * clock is its own, or shared by its owner's instances of the kind, or by every instance of the kind. A shared clock
 * counts down in the step of its first member to step each tick and beats every member at once, in creation order,
 * from there (a member later in the order is seen as it stood before its own frame that tick); a unit several members
 * catch on that beat can go to the hottest only.
 */
export interface AreaPulse<G extends AreaTriggerTypes, State = unknown> extends AreaCatch<G, State> {
  /** The seconds between beats: a number, or read from its stats at every reschedule. */
  readonly seconds: number | AreaFn<G, State, number>;

  /** The seconds to its first beat (a shared clock's, from its first member); `seconds` by default. */
  readonly first?: number;

  /**
   * How the next beat is set: by cadence (the default: the previous beat plus the seconds, so the leftover carries), or
   * by restart (now plus the seconds).
   */
  readonly reschedule?: 'cadence' | 'restart';

  /** Whether a step behind by several beats runs them all (true, the default) or one. */
  readonly catchUp?: boolean;

  /** Whose clock it beats on: its own (the default), its owner's shared with the kind's, or the kind's. */
  readonly clock?: 'own' | 'owner-shared' | 'global';

  /** What a shared clock does once it has no members: starts again with the next (`reset`, the default) or keeps its time. */
  readonly whenEmpty?: 'reset' | 'survive';

  /** What it catches: the units in its placed shape (the default), in a shape of its own (relative to it), or none. */
  readonly hits?: Shape | 'none';

  /** Whether a unit several members catch on one shared beat goes to each (`all`, the default) or the hottest only. */
  readonly pick?: 'all' | 'hottest';

  /** How hot a member is, for `hottest`: the highest wins, the first on ties; its time left by default. */
  heat?(this: void, c: AreaTriggerContext<G, State>): number;

  /** The beat: what it does to the units caught (none, when it catches none). */
  onPulse(this: void, c: AreaTriggerContext<G, State>, hit: AreaHit<G>, out: ProcOut<G>): ProcReturn<G>;
}

/** An area trigger that casts its own spell on its own clock (§II.3.4: the sentry), as its owner, credited to it. */
export interface AreaCaster<G extends AreaTriggerTypes, State = unknown> {
  /** The spell: its name in data, its id in code. */
  readonly spell: G['spellName'] | SpellId;

  /** The seconds between casts: a number, or read from its stats at every cast. */
  readonly seconds: number | AreaFn<G, State, number>;

  /** The seconds to its first cast; `seconds` by default. */
  readonly first?: number;

  /** What each cast is handed (its position, its locked unit); nothing when absent. */
  input?(this: void, c: AreaTriggerContext<G, State>): G['input'] | undefined;
}

/**
 * An aura an area trigger keeps on the units in its shape (§II.3.4, §II.6 A10): `enter-exit` puts it on as a unit
 * enters and takes it off as it leaves (overlapping area triggers counted, so the last one left takes it off);
 * `refresh` tops it up to `linger` seconds every frame the unit is inside (its own clock counts from there), so it
 * lingers after the unit leaves. The units are caught as the area trigger's `auras` part runs, in its shape.
 */
export interface AreaAura<G extends AreaTriggerTypes, State = unknown> extends Omit<AreaCatch<G, State>, 'ledger'> {
  /** The aura: its name in data, its id in code. */
  readonly aura: G['auraName'] | AuraId;

  /** How it is kept: on entry and exit (the default), or refreshed while inside. */
  readonly mode?: 'enter-exit' | 'refresh';

  /** The seconds each refresh tops it up to, under `refresh`. */
  readonly linger?: number;

  /** The stacks each application adds. */
  readonly stacks?: number;

  /** The value each application carries. */
  readonly value?: number;
}

/** A part of an area trigger's frame, in the order `order` runs them. */
export type AreaPhase = 'move' | 'contact' | 'frame' | 'pulses' | 'auras';
