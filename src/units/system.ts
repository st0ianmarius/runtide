import { ownValue } from '../core/records.ts';
import type { StatView } from '../modifiers/index.ts';
import type { SpellId } from '../spells/index.ts';
import type { UnitVariant } from './bases.ts';
import { type SpawnUnit, UnitEngine, unitOf, type UnitSystemOptions } from './engine.ts';
import { damageHostOf, syncHealth } from './hosts.ts';
import { syncStates } from './interrupts.ts';
import { changeSide, moveTo, raiseSpawned } from './lifecycle.ts';
import { createUnitProcKinds } from './proc-kinds.ts';
import type { UnitProcKinds } from './procs.ts';
import { attachScript, creditOf, joinOwner } from './summons.ts';
import type { UnitRegistry } from './unit-def.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * A unit system: one unit shape for heroes, creatures and summons. It spawns units from
 * templates with their stats snapshotted, moves them through their lifecycle, reads their derived states from their
 * aura tags, keeps their health with the resource policy, and is the damage system's unit host.
 */
export interface UnitSystem<G extends UnitTypes> {
  /** The game's unit templates. */
  readonly registry: UnitRegistry<G>;

  /** How many units are live (spawned and not despawned). */
  readonly live: () => number;

  /** Spawns a unit of a template: alive, at full health, its stats its template's with the spawn's on top. */
  readonly spawn: (template: UnitId, spawn: SpawnUnit<G>) => G['bearer'];

  /**
   * A variant of a template with base stats of its own, compiled once: spawn a wave's mobs or a level's elites with it
   * (`spawn(template, { side, variant })`) and they share its bases, where a spawn's own `stats` compile per unit.
   */
  readonly variant: (template: UnitId, stats: Readonly<Partial<Record<G['stat'], number>>>) => UnitVariant;

  /** A live unit by entity id; `undefined` for none. */
  readonly byId: (id: number) => G['bearer'] | undefined;

  /**
   * Despawns a unit: removed without dying, so no rewards, no kill and no death event; its id is freed,
   * and the `despawned` event carries the reason (`despawn` when absent). False for a unit already despawned.
   */
  readonly despawn: (unit: G['bearer'], reason?: string) => boolean;

  /**
   * A unit's summons: the units it owns that are neither dead nor despawned, in the order they joined (a revived one
   * last), whether it lives or not.
   * The system's own list: read it, never keep or change it.
   */
  readonly summonsOf: (unit: G['bearer']) => readonly G['bearer'][];

  /**
   * The entity id a unit's deeds are credited to: its owner's, up the chain, or its own when it has
   * none. A game credits a summon's blows with it (`source`).
   */
  readonly creditOf: (unit: G['bearer']) => number;

  /** A dead unit lives again with some health (its maximum when absent); false when it is not dead. */
  readonly revive: (unit: G['bearer'], health?: number) => boolean;

  /** A unit dies (the damage host's `remove` does this for a death by a blow); false when it is not alive. */
  readonly kill: (unit: G['bearer']) => boolean;

  /** Whether a unit is in a derived state (`stunned`), read from its aura tags now. */
  readonly is: (unit: G['bearer'], state: G['unitState']) => boolean;

  /** Whether a unit may act (cast, attack): it is alive, and holds no aura tag of a state that blocks acting. */
  readonly canAct: (unit: G['bearer']) => boolean;

  /** Whether a unit may move: it is alive, and holds no aura tag of a state that blocks moving. */
  readonly canMove: (unit: G['bearer']) => boolean;

  /**
   * Whether a unit may be picked as a target: it holds no aura tag of a state that blocks targeting (stealth, phasing,
   * a spawn intro). A game's world asks it in its targeting rule (`canTarget`), beside its own (detection, sides).
   */
  readonly isTargetable: (unit: G['bearer']) => boolean;

  /**
   * Puts a unit on another side (a charm, a flag for combat) and raises `sideChanged`, which the game answers by
   * moving it in its world (`setSide`). Returns whether the side changed.
   */
  readonly setSide: (unit: G['bearer'], side: number) => boolean;

  /** Whether a unit has a class tag. */
  readonly hasTag: (unit: G['bearer'], tag: G['unitTag']) => boolean;

  /** A unit's stats: its sheet folded with it as the host, or its own bases without a modifier system. */
  readonly statsOf: (unit: G['bearer']) => StatView;

  /**
   * The unit system's proc kinds (`revive`, `summon`, `despawn`, `despawnSummons`): `createProcRegistry({
   * ...CORE_PROCS, ...units.procKinds })`.
   */
  readonly procKinds: UnitProcKinds<G>;

  /**
   * Brings a unit's interrupts in line with its derived states (`interrupts`): a state entered raises its
   * interrupt on the unit's casts, one left ends it. Wire it as the aura host's `onTagsChanged` (lazily, since the aura
   * system is made first); returns how many states changed.
   */
  readonly syncStates: (unit: G['bearer']) => number;

  /** A unit's auto-attack spell; `undefined` for none, as most heroes have. */
  readonly autoAttackOf: (unit: G['bearer']) => SpellId | undefined;

  /**
   * A unit's maximum health moved: its health follows by the resource policy. Returns the health after. Call
   * it where maximum health can change.
   */
  readonly syncHealth: (unit: G['bearer']) => number;

  /** The damage host the system provides: spread it into the damage system's host. */
  readonly damageHost: ReturnType<typeof damageHostOf<G>>;
}

/**
 * Creates a unit system over the game's templates and the systems a unit bears: `createUnitSystem({ registry:
 * UNITS, auras, spells, abilities, modifiers: { system }, health: { stat: 'maxHealth' }, states })`.
 */
export const createUnitSystem = <G extends UnitTypes>(options: UnitSystemOptions<G>): UnitSystem<G> => {
  const engine = new UnitEngine<G>(options);
  const { registry } = engine;
  const states = options.states;

  const isAlive = (unit: G['bearer']): boolean => unitOf<G>(unit).lifecycle === 'alive';

  const reviveUnit = (unit: G['bearer'], health?: number): boolean => moveTo(engine, unit, ['alive', health]);

  const spawnUnit = (template: UnitId, spawn: SpawnUnit<G>): G['bearer'] => {
    registry.get(template);

    const unit = engine.create(template, spawn);

    joinOwner(unit);
    raiseSpawned(engine, unit, spawn.at);

    // A `spawned` listener that despawned it at once (a refused spawn point) leaves nothing to attach.
    if (unitOf<G>(unit).lifecycle === 'alive') {
      attachScript(engine, [unit, spawn.script]);
    }

    return unit;
  };

  const despawnUnit = (unit: G['bearer'], reason = 'despawn'): boolean =>
    moveTo(engine, unit, ['despawned', undefined, reason]);

  const system: UnitSystem<G> = {
    registry,
    procKinds: createUnitProcKinds<G>({
      engine,
      spawn: spawnUnit,
      revive: reviveUnit,
      despawn: despawnUnit
    }),

    live: () => engine.byId.size,

    spawn: spawnUnit,

    variant: (template, stats) => {
      registry.get(template);

      return engine.bases.variant(template, stats);
    },

    byId: (id) => engine.byId.get(id),
    despawn: despawnUnit,

    summonsOf: (unit) => unitOf<G>(unit).summons,

    creditOf,

    revive: reviveUnit,

    kill: (unit) => moveTo(engine, unit, ['dead', undefined]),

    is: (unit, state) => {
      const bits = states?.tags[state];

      return bits !== undefined && unit.auras.tags.intersects(bits);
    },

    canAct: (unit) => isAlive(unit) && (states === undefined || !unit.auras.tags.intersects(states.blocksAct)),

    canMove: (unit) => isAlive(unit) && (states === undefined || !unit.auras.tags.intersects(states.blocksMove)),

    isTargetable: (unit) => states === undefined || !unit.auras.tags.intersects(states.blocksTarget),

    setSide: (unit, side) => changeSide(engine, unit, side),

    hasTag: (unit, tag) => {
      const ids: Readonly<Record<string, number | undefined>> = registry.tags.id;
      const id = ownValue(ids, tag);

      return id !== undefined && unitOf<G>(unit).tags.has(id);
    },

    syncStates: (unit) => syncStates(engine, unit),
    statsOf: (unit) => engine.statsOf(unit),
    autoAttackOf: (unit) => engine.autoAttacks[unitOf<G>(unit).template],
    syncHealth: (unit) => syncHealth(engine, unit),
    damageHost: damageHostOf(engine)
  };

  return Object.freeze(system);
};
