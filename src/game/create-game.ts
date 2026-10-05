import { type AbilitySystem, createAbilitySystem } from '../abilities/index.ts';
import { type AiSystem, createAiSystem } from '../ai/index.ts';
import { type AreaTriggerHost, type AreaTriggerSystem, createAreaTriggerSystem } from '../area-triggers/index.ts';
import { type AuraHost, type AuraSystem, createAuraSystem } from '../auras/index.ts';
import { createCombatLog } from '../combat-log/index.ts';
import { createEntityIds, type EntityIds } from '../core/index.ts';
import { createDamageSystem, type DamageHost, type DamageSystem } from '../damage/index.ts';
import { createModifierSystem, type ModifierSystem } from '../modifiers/index.ts';
import { createProcSystem, type ProcSystem } from '../procs/index.ts';
import { createScriptSystem, type ScriptSystem } from '../scripts/index.ts';
import { createSpellSystem, type SpellHost, type SpellSystem } from '../spells/index.ts';
import { createUnitSystem, type UnitSystem, type UnitSystemBase } from '../units/index.ts';
import type { Game } from './game.ts';
import { Inspector } from './inspect.ts';
import { checkKinds, extOr, isRecordsChecked, late, type Late } from './late.ts';
import type { GameRecords, GameSpec, GameTypes } from './spec.ts';
import { type GameWorld, worldOf } from './world.ts';

/** A host whose members `createGame` binds once the system providing them is built. */
type Bound<T> = { -readonly [K in keyof T]: T[K] };

/** The systems built before the unit system, and the hosts whose late members are bound after it. */
interface Front<G extends GameTypes & GameRecords<G>> {
  /** The modifier system, if any. */
  readonly modifiers: ModifierSystem<G['bearer'], G['stat'], G['condition'], G['valueKind'], G['source']> | undefined;

  /** The aura system. */
  readonly auras: AuraSystem<G>;

  /** The aura host: `run` and `onTagsChanged` bound late. */
  readonly auraHost: Bound<AuraHost<G>>;

  /** The spell system. */
  readonly spells: SpellSystem<G>;

  /** The spell host: `canAct`, `statsOf` and `isGone` bound late. */
  readonly spellHost: Bound<SpellHost<G>>;

  /** The AI system. */
  readonly ai: AiSystem<G>;

  /** The ability system, if any. */
  readonly abilities: AbilitySystem<G> | undefined;
}

/** The late cells the systems built early read through thunks, filled before `createGame` returns. */
interface Cells<G extends GameTypes & GameRecords<G>> {
  /** The proc system. */
  readonly procs: Late<ProcSystem<G>>;

  /** The unit system. */
  readonly units: Late<UnitSystem<G>>;

  /** The script system. */
  readonly scripts: Late<ScriptSystem<G>>;
}

/** Builds the modifier, aura, spell, AI and ability systems, in that order. */
const buildFront = <G extends GameTypes & GameRecords<G>>(spec: GameSpec<G>, cells: Cells<G>): Front<G> => {
  const { clock } = spec;
  const modifiers = spec.modifiers === undefined ? undefined : createModifierSystem(spec.modifiers);
  const auraHost: Bound<AuraHost<G>> = { ...spec.auras.host };

  const auras = createAuraSystem<G>({
    ...spec.auras,
    host: auraHost,
    createExt: extOr(spec.auras.createExt),
    ...(modifiers === undefined ? {} : { modifiers })
  });

  const spellHost: Bound<SpellHost<G>> & G['host'] = { idOf: (unit) => unit.id, ...spec.spells.host };

  const spells = createSpellSystem<G>({
    ...spec.spells,
    auras,
    procs: cells.procs.get,
    clock,
    host: spellHost,
    createExt: extOr(spec.spells.createExt)
  });

  const ai = createAiSystem<G>({ ...spec.ai, spells, clock });

  const abilities =
    spec.abilities === undefined
      ? undefined
      : createAbilitySystem<G>({
          statsOf: (caster, spell) => cells.units.get().hosts.spell.statsOf(caster, spell),
          ...spec.abilities,
          spells,
          auras,
          clock
        });

  return { modifiers, auras, auraHost, spells, spellHost, ai, abilities };
};

/** Builds the area trigger system over the world, its `isGone` bound once the units are built. */
const buildAreas = <G extends GameTypes & GameRecords<G>>(
  spec: GameSpec<G>,
  front: Front<G>,
  world: GameWorld<G>,
  ids: EntityIds,
  cells: Cells<G>
): { readonly areas: AreaTriggerSystem<G>; readonly host: Bound<AreaTriggerHost<G>> } | undefined => {
  if (spec.areas === undefined) {
    return undefined;
  }

  const query = world.query ?? missingWorld();
  const { spells, auras } = front;

  const host: Bound<AreaTriggerHost<G>> & G['host'] = {
    idOf: (unit) => unit.id,
    ...spec.areas.host,
    allocateId: ids.next
  };

  const areas = createAreaTriggerSystem<G>({
    ...spec.areas,
    spells,
    auras,
    procs: cells.procs.get,
    world: query,
    clock: spec.clock,
    host,
    createExt: extOr(spec.areas.createExt)
  });

  return { areas, host };
};

/** Throws: area triggers ask a world. */
const missingWorld = (): never => {
  throw new RangeError('createGame: area triggers need a world (GameSpec.world).');
};

/** Builds the unit system over the front systems, the area triggers' `ownerGone` and the shared id space. */
const buildUnits = <G extends GameTypes & GameRecords<G>>(
  spec: GameSpec<G>,
  front: Front<G>,
  areas: AreaTriggerSystem<G> | undefined,
  ids: EntityIds,
  cells: Cells<G>
): { readonly units: UnitSystem<G>; readonly health: Bound<UnitSystemBase<G>['health']> } => {
  const { scopeOf, ...rest } = spec.units;
  const { modifiers, auras, spells, ai, abilities } = front;
  const health: Bound<UnitSystemBase<G>['health']> = { ...spec.units.health };

  const units = createUnitSystem<G>({
    ...rest,
    auras,
    spells,
    ai,
    health,
    allocateId: ids.next,
    createExt: spec.units.createExt ?? extOr<G['unitExt']>(undefined),
    ...(abilities === undefined ? {} : { abilities }),
    ...(areas === undefined ? {} : { areaTriggers: { ownerGone: areas.ownerGone } }),
    ...(spec.scripts === undefined ? {} : { scripts: () => cells.scripts.get().forUnits }),
    ...(modifiers === undefined
      ? {}
      : { modifiers: { system: modifiers, ...(scopeOf === undefined ? {} : { scopeOf }) } })
  });

  return { units, health };
};

/** Builds the damage system over the units' damage host; `run` forwards to the proc system until it is bound. */
const buildDamage = <G extends GameTypes & GameRecords<G>>(
  spec: GameSpec<G>,
  auras: AuraSystem<G>,
  units: UnitSystem<G>,
  cells: Cells<G>
): { readonly damage: DamageSystem<G>; readonly host: Bound<DamageHost<G>> } => {
  const host: Bound<DamageHost<G>> = {
    ...spec.damage.host,
    ...units.damageHost,
    run: (procs, ctx) => {
      cells.procs.get().runAura(procs, ctx);
    }
  };

  const options = { ...spec.damage, auras, host };

  if (!isRecordsChecked(options)) {
    throw new TypeError('createGame: a game whose blow and force are not the framework records has no damage system.');
  }

  return { damage: createDamageSystem<G>(options), host };
};

/** Builds the proc system over every system's kinds, naming units by entity id, and checks it holds them all. */
const buildProcs = <G extends GameTypes & GameRecords<G>>(
  spec: GameSpec<G>,
  parts: Pick<Game<G>, 'auras' | 'spells' | 'ai' | 'units' | 'damage' | 'areas'>
): ProcSystem<G> => {
  const { auras, spells, ai, units, damage, areas } = parts;

  const kinds = {
    damage: damage.procKinds,
    spells: spells.procKinds,
    units: units.procKinds,
    ai: ai.procKinds,
    areas: areas?.procKinds
  };

  const procs = createProcSystem<G>({
    ...spec.procs,
    kinds: spec.procs.kinds(kinds),
    auras,
    host: { ...spec.procs.host, idOf: (unit) => unit.id, unitOf: units.byId }
  });

  checkKinds(procs.kinds, kinds);

  return procs;
};

/**
 * Assembles a whole game from each system's options (`GameSpec`): builds the systems in the order they need each
 * other (modifiers, auras, spells, AI, abilities, world, area triggers, units, damage, procs, scripts, combat log),
 * binds every late edge before it returns (the aura host's `run` and `onTagsChanged`, the spell host's `canAct`,
 * `statsOf` and `isGone`, the area host's `isGone`, the damage host's `run` and `procs`, the units' `onLethal` and
 * scripts, the procs' and scripts' thunks), keeps a memory world in step with the units, and runs the unit system's
 * wiring check. It does not step anything: the game runs the tick loop `Game` documents.
 */
export const createGame = <G extends GameTypes & GameRecords<G>>(spec: GameSpec<G>): Game<G> => {
  const cells: Cells<G> = { procs: late('procs'), units: late('units'), scripts: late('scripts') };
  const ids = spec.ids ?? createEntityIds();
  const front = buildFront(spec, cells);
  const { auras, spells, ai, auraHost, spellHost } = front;
  const world = worldOf(spec.world, spec.bus, spec.units.events);
  const area = buildAreas(spec, front, world, ids, cells);
  const areas = area?.areas;
  const { units, health } = buildUnits(spec, front, areas, ids, cells);
  const { damage, host: damageHost } = buildDamage(spec, auras, units, cells);
  const procs = buildProcs(spec, { auras, spells, ai, units, damage, areas });
  const scripts = spec.scripts === undefined ? undefined : createScriptSystem<G>({ ...spec.scripts, ai, procs });
  const { clock } = spec;

  const combatLog =
    spec.combatLog === undefined ? undefined : createCombatLog({ ...spec.combatLog, clock, idOf: (unit) => unit.id });

  cells.units.set(units);
  cells.procs.set(procs);

  if (scripts !== undefined) {
    cells.scripts.set(scripts);
  }

  auraHost.run = procs.runAura;
  auraHost.onTagsChanged = units.hosts.aura.onTagsChanged;
  Object.assign(spellHost, units.hosts.spell);
  damageHost.run = procs.runAura;
  damageHost.procs = procs;
  health.onLethal ??= (unit) => {
    damage.kill(unit);
  };

  if (area !== undefined) {
    area.host.isGone = units.hosts.area.isGone;
  }

  units.checkWiring({ spells, auras, ai, procs, damage, ...(areas === undefined ? {} : { areaTriggers: areas }) });

  const inspector = new Inspector<G>({
    clock,
    auras,
    spells,
    ai,
    units,
    areas,
    world: world.digest,
    streams: spec.streams,
    combatLog
  });

  return Object.freeze({
    clock,
    modifiers: front.modifiers,
    auras,
    spells,
    ai,
    abilities: front.abilities,
    ids,
    world: world.query,
    memoryWorld: world.memory,
    areas,
    units,
    damage,
    procs,
    scripts,
    combatLog,
    digest: inspector.digest,
    audit: inspector.audit
  });
};
