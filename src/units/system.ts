import type { Bitset } from '../core/index.ts';
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
import { attachScript, creditOf, isBoundToGone, joinOwner } from './summons.ts';
import type { UnitRegistry } from './unit-def.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';
import { checkWiring, hostsOf, type UnitHosts, type UnitWiring } from './wiring.ts';

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

  /**
   * Spawns a unit of a template: alive, at full health, its stats its template's with the spawn's on top. Throws a
   * `RangeError` for a stat that is not finite, or a maximum health that is not a finite number above 0. A bound spawn
   * whose owner is not alive (spawned from its owner's death) is despawned at once (reason `owner`), as its owner's
   * death would have: the unit comes back despawned.
   */
  readonly spawn: (template: UnitId, spawn: SpawnUnit<G>) => G['bearer'];

  /**
   * Spawns a unit as `spawn` does once the game's `admit` lets it; `undefined`, with nothing made, when it refuses (a
   * crowd at its cap, a placement that failed), or when it is bound to an owner that is not alive.
   */
  readonly trySpawn: (template: UnitId, spawn: SpawnUnit<G>) => G['bearer'] | undefined;

  /**
   * A variant of a template with base stats of its own, compiled once: spawn a wave's mobs or a level's elites with it
   * (`spawn(template, { side, variant })`) and they share its bases, where a spawn's own `stats` compile per unit.
   */
  readonly variant: (template: UnitId, stats: Readonly<Partial<Record<G['stat'], number>>>) => UnitVariant;

  /** A live unit by entity id; `undefined` for none. */
  readonly byId: (id: number) => G['bearer'] | undefined;

  /**
   * Despawns a unit: removed without dying, so no rewards, no kill and no death event; its id is freed,
   * and the `despawned` event carries the reason (`despawn` when absent). False for a unit already despawned; true when
   * queued behind a lifecycle move of the unit running now (as `revive`).
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

  /**
   * A dead unit lives again with some health (its maximum when absent); false when it is not dead. True too when it is
   * queued behind a lifecycle move of the unit running now (a revive from its death's `onState`), which runs once that
   * move is done and may still be refused then: read its `lifecycle` after.
   */
  readonly revive: (unit: G['bearer'], health?: number) => boolean;

  /**
   * A unit's lifecycle moves to dead, its health set to 0 first; false when it is not alive (true when queued, as
   * `revive`). It is the lifecycle move alone: no death event, kill credit or reward. For a death through the death
   * pipeline, call the damage system's `damage.kill(unit, credit)` or `damage.setHealth(unit, 0)`, whose host's
   * `remove` makes this move. A downed hero is a dead unit, revived by `revive`.
   */
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

  /**
   * A unit's stats: its sheet folded with it as the host, or its own bases without a modifier system. With `against`,
   * folded against that unit, for the modifiers that ask about it (`against`, `againstValue`); with `scope`, within
   * those spell scopes (a spell's registry tags, `spells.registry.tagSets[spell]`): a view to read at once, since the
   * next such read of the unit reuses it.
   */
  readonly statsOf: (unit: G['bearer'], against?: G['bearer'], scope?: Bitset) => StatView;

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

  /**
   * The spell and aura host members the system provides: spread `hosts.spell` into the spell host (`canAct`, `statsOf`)
   * and `hosts.aura` into the aura host (`onTagsChanged`), lazily where the host is made before the unit system.
   */
  readonly hosts: UnitHosts<G>;

  /**
   * Checks the game's wiring once it is assembled (`units.checkWiring({ spells, auras, ai, procs, areaTriggers })`):
   * throws a `RangeError` naming the first gate left unwired that the systems let it see.
   */
  readonly checkWiring: (wiring: UnitWiring<G>) => void;
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

  const reviveUnit = (unit: G['bearer'], health?: number): boolean => moveTo(engine, unit, 'alive', health);

  const spawnUnit = (template: UnitId, spawn: SpawnUnit<G>): G['bearer'] => {
    registry.get(template);

    const unit = engine.create(template, spawn);
    const stays = joinOwner(unit);

    raiseSpawned(engine, unit, spawn.at);

    // Bound to an owner gone already: it goes as that owner's death or despawn would have taken it.
    if (!stays) {
      moveTo(engine, unit, 'despawned', undefined, 'owner');
    }

    // A `spawned` listener that despawned it at once (a refused spawn point) leaves nothing to attach.
    if (unitOf<G>(unit).lifecycle === 'alive') {
      attachScript(engine, [unit, spawn.script]);
    }

    return unit;
  };

  const despawnUnit = (unit: G['bearer'], reason = 'despawn'): boolean =>
    moveTo(engine, unit, 'despawned', undefined, reason);

  const canAct = (unit: G['bearer']): boolean =>
    isAlive(unit) && (states === undefined || !unit.auras.tags.intersects(states.blocksAct));

  const procKinds = createUnitProcKinds<G>({ engine, spawn: spawnUnit, revive: reviveUnit, despawn: despawnUnit });

  const system: UnitSystem<G> = {
    registry,
    procKinds,

    live: () => engine.byId.size,

    spawn: spawnUnit,

    trySpawn: (template, spawn) => {
      registry.get(template);

      return isBoundToGone(spawn) || options.admit?.(template, spawn) === false
        ? undefined
        : spawnUnit(template, spawn);
    },

    variant: (template, stats) => {
      registry.get(template);

      return engine.bases.variant(template, stats);
    },

    byId: (id) => engine.byId.get(id),
    despawn: despawnUnit,

    summonsOf: (unit) => unitOf<G>(unit).summons,

    creditOf,

    revive: reviveUnit,

    kill: (unit) => moveTo(engine, unit, 'dead', 0),

    is: (unit, state) => {
      const bits = states?.tags[state];

      return bits !== undefined && unit.auras.tags.intersects(bits);
    },

    canAct,

    canMove: (unit) => isAlive(unit) && (states === undefined || !unit.auras.tags.intersects(states.blocksMove)),

    isTargetable: (unit) => states === undefined || !unit.auras.tags.intersects(states.blocksTarget),

    setSide: (unit, side) => changeSide(engine, unit, side),

    hasTag: (unit, tag) => {
      const ids: Readonly<Record<string, number | undefined>> = registry.tags.id;
      const id = ownValue(ids, tag);

      return id !== undefined && unitOf<G>(unit).tags.has(id);
    },

    syncStates: (unit) => syncStates(engine, unit),
    statsOf: (unit, against, scope) => engine.statsOf(unit, against, scope),
    autoAttackOf: (unit) => engine.autoAttacks[unitOf<G>(unit).template],
    syncHealth: (unit) => syncHealth(engine, unit),
    damageHost: damageHostOf(engine),
    hosts: hostsOf(engine, { canAct, syncStates: (unit) => syncStates(engine, unit) }),
    checkWiring: (wiring) => {
      checkWiring(engine, procKinds, wiring);
    }
  };

  return Object.freeze(system);
};
