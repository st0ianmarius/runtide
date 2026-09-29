import type { AuraApplication, AuraDecision } from '../auras/index.ts';
import type { ForceStage, StageDef } from '../damage/index.ts';
import type { StatView } from '../modifiers/index.ts';
import type { SpellId } from '../spells/index.ts';
import { type SpawnUnit, UnitEngine, unitOf, type UnitSystemOptions } from './engine.ts';
import { type AuraRule, compileRules, damageHostOf, decideAura, forceStageOf, syncHealth } from './hosts.ts';
import { syncStates } from './interrupts.ts';
import { moveTo, raiseSpawned } from './lifecycle.ts';
import { createUnitProcKinds, type UnitProcKinds } from './procs.ts';
import { HEAVY, OBJECTIVE } from './unit-def.ts';
import type { UnitRegistry } from './unit-def.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * A unit system (§I.7.1 F13, §II.6 U1–U3): one unit shape for heroes, creatures and summons. It spawns units from
 * templates with their stats snapshotted, moves them through their lifecycle, reads their derived states from their
 * aura tags, keeps their health with the resource policy, and is the damage system's unit host.
 */
export interface UnitSystem<G extends UnitTypes> {
  /** The game's unit templates. */
  readonly registry: UnitRegistry<G>;

  /** How many units are live (spawned and not despawned). */
  readonly live: () => number;

  /** Spawns a unit of a template (§II.6 U1): standing, at full health, its stats its template's with the spawn's on top. */
  readonly spawn: (template: UnitId, spawn: SpawnUnit<G>) => G['bearer'];

  /** A live unit by entity id; `undefined` for none. */
  readonly byId: (id: number) => G['bearer'] | undefined;

  /**
   * Despawns a unit (§II.6 U1, D5): removed without dying, so no rewards, no kill and no death event; its id is freed.
   * False for a unit already despawned.
   */
  readonly despawn: (unit: G['bearer']) => boolean;

  /** A standing or disconnected unit goes down (revivable); false when its state does not allow it. */
  readonly down: (unit: G['bearer']) => boolean;

  /** A downed or dead unit stands again with some health (its maximum when absent); false when it cannot. */
  readonly revive: (unit: G['bearer'], health?: number) => boolean;

  /** A unit dies (the damage host's `remove` does this for a death by a blow); false when it cannot. */
  readonly kill: (unit: G['bearer']) => boolean;

  /** A standing or downed unit's player leaves; the unit stays. False when it cannot. */
  readonly disconnect: (unit: G['bearer']) => boolean;

  /** A disconnected unit's player is back; false when it was not disconnected. */
  readonly reconnect: (unit: G['bearer']) => boolean;

  /** Whether a unit is in a derived state (`stunned`), read from its aura tags now. */
  readonly is: (unit: G['bearer'], state: G['unitState']) => boolean;

  /** Whether a unit may act (cast, attack): it stands, and holds no aura tag of a state that blocks acting. */
  readonly canAct: (unit: G['bearer']) => boolean;

  /** Whether a unit may move: it stands, and holds no aura tag of a state that blocks moving. */
  readonly canMove: (unit: G['bearer']) => boolean;

  /** Whether a unit has a class tag. */
  readonly hasTag: (unit: G['bearer'], tag: G['unitTag']) => boolean;

  /** Whether a unit's template is an objective (a side of its own for targeting and kill accounting). */
  readonly isObjective: (unit: G['bearer']) => boolean;

  /** Whether a unit's template is heavy. */
  readonly isHeavy: (unit: G['bearer']) => boolean;

  /** A unit's stats (§II.6 M9): its sheet folded with it as the host, or its own bases without a modifier system. */
  readonly statsOf: (unit: G['bearer']) => StatView;

  /** The unit system's proc kinds (`revive`): `createProcRegistry({ ...CORE_PROCS, ...units.procKinds })`. */
  readonly procKinds: UnitProcKinds<G>;

  /**
   * Brings a unit's interrupts in line with its derived states (§I.7.1 F16, `interrupts`): a state entered raises its
   * interrupt on the unit's casts, one left ends it. Wire it as the aura host's `onTagsChanged` (lazily, since the aura
   * system is made first); returns how many states changed.
   */
  readonly syncStates: (unit: G['bearer']) => number;

  /** A unit's auto-attack spell (§II.6 S3); `undefined` for none, as most heroes have. */
  readonly autoAttackOf: (unit: G['bearer']) => SpellId | undefined;

  /**
   * A unit's maximum health moved (§II.6 M7): its health follows by the resource policy. Returns the health after. Call
   * it where maximum health can change.
   */
  readonly syncHealth: (unit: G['bearer']) => number;

  /** The damage host the system provides: spread it into the damage system's host. */
  readonly damageHost: ReturnType<typeof damageHostOf<G>>;

  /** The force stage the system provides (§II.6 D4): add it to the damage system's `forceStages`. */
  readonly forceStage: StageDef<ForceStage<G>>;

  /**
   * The application policy of a list of rules (§II.6 A2), compiled once: the aura host's `onIncomingAura`. Wire it
   * lazily, since the aura system is made first.
   */
  readonly auraPolicy: (
    rules: readonly AuraRule<G>[],
  ) => (unit: G['bearer'], application: AuraApplication<G>) => AuraDecision<G> | undefined;
}

/**
 * Creates a unit system over the game's templates and the systems a unit bears (§I.5): `createUnitSystem({ registry:
 * UNITS, auras, spells, abilities, modifiers: { system, base: 'base' }, health: { stat: 'maxHealth' }, states })`.
 */
export const createUnitSystem = <G extends UnitTypes>(options: UnitSystemOptions<G>): UnitSystem<G> => {
  const engine = new UnitEngine<G>(options);
  const { registry } = engine;
  const states = options.states;
  const traitsOf = (unit: G['bearer']): number => registry.traits[unitOf<G>(unit).template] ?? 0;

  const isStanding = (unit: G['bearer']): boolean => unitOf<G>(unit).lifecycle === 'standing';

  const reviveUnit = (unit: G['bearer'], health?: number): boolean =>
    unitOf<G>(unit).lifecycle !== 'disconnected' && moveTo(engine, unit, ['standing', health]);

  const system: UnitSystem<G> = {
    registry,
    procKinds: createUnitProcKinds<G>(reviveUnit),

    live: () => engine.byId.size,

    spawn: (template, spawn) => {
      registry.get(template);

      const unit = engine.create(template, spawn);

      raiseSpawned(engine, unit);

      return unit;
    },

    byId: (id) => engine.byId.get(id),
    despawn: (unit) => moveTo(engine, unit, ['despawned', undefined]),
    down: (unit) => moveTo(engine, unit, ['downed', undefined]),

    revive: reviveUnit,

    kill: (unit) => moveTo(engine, unit, ['dead', undefined]),

    disconnect: (unit) => unitOf<G>(unit).lifecycle !== 'dead' && moveTo(engine, unit, ['disconnected', undefined]),

    reconnect: (unit) => unitOf<G>(unit).lifecycle === 'disconnected' && moveTo(engine, unit, ['standing', undefined]),

    is: (unit, state) => {
      const bits = states?.tags[state];

      return bits !== undefined && unit.auras.tags.intersects(bits);
    },

    canAct: (unit) => isStanding(unit) && (states === undefined || !unit.auras.tags.intersects(states.blocksAct)),
    canMove: (unit) => isStanding(unit) && (states === undefined || !unit.auras.tags.intersects(states.blocksMove)),

    hasTag: (unit, tag) => {
      const ids: Readonly<Record<string, number | undefined>> = registry.tags.id;
      const id = ids[tag];

      return id !== undefined && unitOf<G>(unit).tags.has(id);
    },

    isObjective: (unit) => (traitsOf(unit) & OBJECTIVE) !== 0,
    isHeavy: (unit) => (traitsOf(unit) & HEAVY) !== 0,
    syncStates: (unit) => syncStates(engine, unit),
    statsOf: (unit) => engine.statsOf(unit),
    autoAttackOf: (unit) => engine.autoAttacks[unitOf<G>(unit).template],
    syncHealth: (unit) => syncHealth(engine, unit),
    damageHost: damageHostOf(engine),
    forceStage: forceStageOf(engine),

    auraPolicy: (rules) => {
      const compiled = compileRules(engine, rules);

      return (unit, application) => decideAura(engine, [compiled, unit], application);
    },
  };

  return Object.freeze(system);
};
