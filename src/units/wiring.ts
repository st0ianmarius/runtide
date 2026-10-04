import type { AiSystem } from '../ai/index.ts';
import type { AuraHost, AuraSystem } from '../auras/index.ts';
import type { DamageHost, DamageSystem } from '../damage/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { SpellClock, SpellHost, SpellId, SpellSystem } from '../spells/index.ts';
import { type UnitEngine, unitOf } from './engine.ts';
import { type damageHostOf, scopeFor } from './hosts.ts';
import type { UnitProcKinds } from './procs.ts';
import type { UnitTypes } from './unit-types.ts';

/** The systems a game wired around its unit system, for `units.checkWiring`. */
export interface UnitWiring<G extends UnitTypes> {
  /** The spell system every unit casts through. */
  readonly spells: SpellSystem<G>;

  /** The aura system every unit bears auras through. */
  readonly auras: AuraSystem<G>;

  /** The AI system, when units think. */
  readonly ai?: AiSystem<G>;

  /** The proc system, when the game runs procs: it must hold the unit system's kinds and name units by id. */
  readonly procs?: ProcSystem<G>;

  /**
   * The area trigger system, when the game has one: the unit system must end a gone owner's areas, and its clock
   * (`clock`) must be the spell system's.
   */
  readonly areaTriggers?: {
    /** The clock its lifetimes count on, when it says. */
    readonly clock?: SpellClock;
  };

  /**
   * The damage system, when the game has one: its host's health, liveness and removal must be the unit system's
   * (`units.damageHost` spread into it), and it must be built over the same aura system.
   */
  readonly damage?: DamageSystem<G>;
}

/** What the unit system hands its wiring check besides its engine: its own proc kinds and damage host. */
interface UnitOwnParts<G extends UnitTypes> {
  /** The unit system's proc kinds (`units.procKinds`). */
  readonly kinds: UnitProcKinds<G>;

  /** The damage host the unit system provides (`units.damageHost`). */
  readonly damageHost: ReturnType<typeof damageHostOf<G>>;
}

/** The liveness gate the unit system gives the hosts that ask it. */
export interface UnitLiveness<G extends UnitTypes> {
  /** Whether a unit has left life (dead or despawned): its lifecycle is not `alive`. */
  readonly isGone: (unit: G['bearer']) => boolean;
}

/** The host members the unit system provides, built from its own rules, for a game to spread into each host. */
export interface UnitHosts<G extends UnitTypes> {
  /**
   * The spell host's: a unit acts while `units.canAct`, reads its stats within a spell's scopes, as the damage host
   * does, and has left life once its lifecycle is not `alive` (`isGone`).
   */
  readonly spell: Required<Pick<SpellHost<G>, 'canAct' | 'statsOf'>> & UnitLiveness<G>;

  /** The aura host's: a tagged aura's edge brings the unit's interrupts in line (`units.syncStates`). */
  readonly aura: Required<Pick<AuraHost<G>, 'onTagsChanged'>>;

  /**
   * The area trigger host's: a unit has left life once its lifecycle is not `alive` (`isGone`), so an area trigger
   * that needs its owner, spawned for one already gone, ends at once.
   */
  readonly area: UnitLiveness<G>;
}

/** Throws a `RangeError` naming a gate the game left unwired. */
const unwired = (gate: string, problem: string): never => {
  throw new RangeError(`Unit system wiring, ${gate}: ${problem}.`);
};

/** Throws unless the unit system was built over these spell, aura and AI systems. */
const checkSystems = <G extends UnitTypes>(engine: UnitEngine<G>, wiring: UnitWiring<G>): void => {
  const { options } = engine;

  if (options.spells !== wiring.spells) {
    unwired('spells', 'the unit system was built over another spell system');
  }

  if (options.auras !== wiring.auras) {
    unwired('auras', 'the unit system was built over another aura system');
  }

  if (wiring.ai !== undefined && options.ai !== wiring.ai) {
    unwired('ai', 'the unit system was not given this AI system, so its units have no brains it steps');
  }

  const states: readonly string[] = ['dead', 'despawned'];

  for (const state of states) {
    if (!wiring.auras.hasState(state)) {
      unwired(`auras.states`, `the aura system declares no ${state} state, so no aura hears or leaves on it`);
    }
  }
};

/** Throws unless a proc system holds the unit system's own kinds and names units by entity id. */
const checkProcs = <G extends UnitTypes>(kinds: UnitProcKinds<G>, procs: ProcSystem<G>, auras: AuraSystem<G>): void => {
  for (const [name, kind] of Object.entries(kinds)) {
    const id = procs.kinds.id[name];

    if (id === undefined || !Object.is(procs.kinds.defs[id], kind)) {
      unwired('procs.kinds', `the proc registry does not hold units.procKinds.${name}`);
    }
  }

  if (procs.host.idOf === undefined || procs.host.unitOf === undefined) {
    unwired('procs.host', 'idOf and unitOf name units by entity id (unit.id, units.byId)');
  }

  if (procs.auras !== auras) {
    unwired('procs.auras', 'the proc system was built over another aura system');
  }
};

/** The damage host members that must be the unit system's own: health, liveness and removal. */
const DAMAGE_MEMBERS = [
  'health',
  'setHealth',
  'isGone',
  'remove'
] as const satisfies readonly (keyof DamageHost<UnitTypes>)[];

/** Throws unless a damage system's host reads and writes units through the unit system, over the same auras. */
const checkDamage = <G extends UnitTypes>(
  own: UnitOwnParts<G>,
  damage: DamageSystem<G>,
  auras: AuraSystem<G>
): void => {
  for (const member of DAMAGE_MEMBERS) {
    if (damage.host[member] !== own.damageHost[member]) {
      unwired(`damage.host.${member}`, "spread units.damageHost into the damage host, so health and death are units'");
    }
  }

  if (damage.auras !== auras) {
    unwired('damage.auras', 'the damage system was built over another aura system');
  }
};

/**
 * Throws unless the hosts carry the unit system's gates: the spell host's `canAct` (a stunned or dead unit casts
 * nothing), the aura host's `onTagsChanged` (a stun's edge raises its interrupt), and every unit state's interrupt
 * being one the spell system knows.
 */
const checkHosts = <G extends UnitTypes>(engine: UnitEngine<G>, wiring: UnitWiring<G>): void => {
  if (wiring.spells.host.canAct === undefined) {
    unwired(
      'spells.host.canAct',
      'spread units.hosts.spell into the spell host, so a stunned or dead unit casts nothing'
    );
  }

  if (wiring.auras.host.onTagsChanged === undefined) {
    unwired('auras.host.onTagsChanged', "spread units.hosts.aura into the aura host, so a state's edge syncs it");
  }

  for (const state of engine.interrupting) {
    if (!wiring.spells.hasInterrupt(state.reason)) {
      unwired(
        'spells.interrupts',
        `the unit state interrupt ${state.reason} is not one the spell system knows (its interrupts or a timeline's)`
      );
    }
  }
};

/** Throws unless the systems that expose their clock share the spell system's. */
const checkClocks = <G extends UnitTypes>(wiring: UnitWiring<G>): void => {
  const { clock } = wiring.spells;

  if (wiring.ai !== undefined && wiring.ai.clock !== clock) {
    unwired('ai.clock', "the AI system counts on another clock than the spell system's");
  }

  const areaClock = wiring.areaTriggers?.clock;

  if (areaClock !== undefined && areaClock !== clock) {
    unwired('areaTriggers.clock', "the area trigger system counts on another clock than the spell system's");
  }
};

/** Throws unless an area trigger system's owners leave with the unit system's units and draw ids from one counter. */
const checkAreas = <G extends UnitTypes>(engine: UnitEngine<G>): void => {
  if (engine.options.areaTriggers === undefined) {
    unwired(
      'areaTriggers',
      "the unit system was not given the area triggers' ownerGone, so a gone owner's areas live on"
    );
  }

  if (engine.options.allocateId === undefined) {
    unwired('allocateId', 'units and area triggers share one id space, so both draw from one counter');
  }
};

/**
 * Checks, once the game is assembled, the gates its systems read of each other that the unit system can see: that it
 * was built over these spell, aura and AI systems; that the aura system declares the `dead` and `despawned` states;
 * that the spell host has a `canAct` and the aura host an `onTagsChanged` (spread from `units.hosts`; a lazy wrapper
 * passes, so only their presence is checked) and every unit state's interrupt is one the spell system knows
 * (`spells.hasInterrupt`); that the AI and area trigger systems count on the spell system's clock; that the proc
 * system holds `units.procKinds` and names units by id; that a damage system's host has the unit system's `health`,
 * `setHealth`, `isGone` and `remove` and its aura system is this one; and that an area trigger system has the unit
 * system end a gone owner's areas (`areaTriggers`) and draw ids from one counter (`allocateId`). Throws a `RangeError`
 * naming the first gate left unwired. The aura and damage hosts' `run` and the area host's `isGone` are not readable
 * from the systems: `createGame` binds them.
 */
export const checkWiring = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  own: UnitOwnParts<G>,
  wiring: UnitWiring<G>
): void => {
  checkSystems(engine, wiring);
  checkHosts(engine, wiring);
  checkClocks(wiring);

  if (wiring.procs !== undefined) {
    checkProcs(own.kinds, wiring.procs, wiring.auras);
  }

  if (wiring.damage !== undefined) {
    checkDamage(own, wiring.damage, wiring.auras);
  }

  if (wiring.areaTriggers !== undefined) {
    checkAreas(engine);
  }
};

/** The host members the unit system provides, built over its engine and its gates. */
export const hostsOf = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  rules: {
    /** Whether a unit may act. */
    readonly canAct: (unit: G['bearer']) => boolean;

    /** Brings a unit's interrupts in line with its states. */
    readonly syncStates: (unit: G['bearer']) => number;
  }
): UnitHosts<G> => {
  const isGone = (unit: G['bearer']): boolean => unitOf<G>(unit).lifecycle !== 'alive';

  return Object.freeze({
    spell: Object.freeze({
      canAct: (caster: G['bearer']) => rules.canAct(caster),
      statsOf: (caster: G['bearer'], spell: SpellId) => engine.statsOf(caster, undefined, scopeFor(engine, spell)),
      isGone
    }),

    aura: Object.freeze({
      onTagsChanged: (bearer: G['bearer']) => {
        rules.syncStates(bearer);
      }
    }),

    area: Object.freeze({ isGone })
  });
};
