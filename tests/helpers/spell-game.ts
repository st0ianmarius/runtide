import {
  type AnyAreaTriggerDef,
  type AreaTriggerEvent,
  areaTriggerEvent,
  type AreaTriggerHost,
  type AreaTriggerId,
  type AreaTriggerProcs,
  type AreaTriggerSystem,
  type AreaTriggerTypes,
  createAreaTriggerEvent,
  createAreaTriggerSystem,
  defineAreaTags,
  defineAreaTriggers,
} from '../../src/area-triggers/index.ts';
import {
  type AuraDef,
  type AuraEvent,
  type AuraId,
  type AuraState,
  type AuraSystem,
  createAuraEvent,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../../src/auras/index.ts';
import {
  createBus,
  createClock,
  createStreamTable,
  defineTickSlots,
  type SimClock,
  stream,
} from '../../src/core/index.ts';
import { createCueBuffer, type CueBuffer, defineCue, defineCues } from '../../src/cues/index.ts';
import {
  type Blow,
  createDamageEvent,
  createDamageSystem,
  createDeathEvent,
  createHealEvent,
  type DamageEvent,
  type DamageProcs,
  type DamageSystem,
  type DamageTypes,
  type DeathEvent,
  defineDamageKinds,
  type Force,
  type HealEvent,
} from '../../src/damage/index.ts';
import type { Vec2 } from '../../src/math/index.ts';
import { defineStats, type StatView } from '../../src/modifiers/index.ts';
import {
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  type Proc,
  type ProcContext,
  type ProcSystem,
} from '../../src/procs/index.ts';
import {
  type ActivationRegistry,
  type ActivationShape,
  type AnySpellDef,
  type CasterState,
  createSpellEvent,
  createSpellSystem,
  defineSpell,
  defineSpells,
  defineSpellTags,
  type SpellCaster,
  type SpellEvent,
  type SpellHost,
  type SpellId,
  type SpellProcs,
  type SpellRegistry,
  type SpellSystem,
  type SpellSystemBase,
  spellTriggerEvent,
} from '../../src/spells/index.ts';
import { createTriggerSystem, type TriggerDef, type TriggerTypes } from '../../src/triggers/index.ts';
import { createMemoryWorld, type MemoryWorld } from '../../src/world/index.ts';

/** A test unit: an entity id, a place, health, a stat column per stat, its auras and its casts. */
export interface Unit extends SpellCaster {
  /** Its entity id. */
  readonly id: number;

  /** Where it stands: `place` moves it, in the world too. */
  at: Vec2;

  /** Its health. */
  hp: number;

  /** Its stat totals, by stat id (the tests write them directly). */
  readonly stats: Float64Array;

  /** Its auras. */
  readonly auras: AuraState;

  /** Its casts. */
  readonly casts: CasterState;
}

/** The test game's own activation kind: a cast that needs at least some rank. */
export interface Charged extends ActivationShape {
  /** The discriminant. */
  readonly kind: 'charged';

  /** The lowest rank that may cast. */
  readonly least: number;
}

/** The test game's own host services. */
interface GameHost {
  /** What happened, as lines. */
  readonly log: string[];
}

/** A cast's game fields. */
interface CastFields {
  /** A counter the tests write. */
  hits: number;
}

/** The test game's types. */
export interface Game extends AreaTriggerTypes, DamageTypes, TriggerTypes {
  /** A test unit. */
  readonly bearer: Unit;

  /** The game's procs. */
  readonly proc: Proc<Game>;

  /** The game's triggers. */
  readonly trigger: TriggerDef<Game>;

  /** The spell and area trigger events, as trigger events. */
  readonly event: 'spellStart' | 'spellRelease' | 'spellHit' | 'spellEnd' | 'areaSpawned' | 'areaEnded';

  /** The spell and area trigger events' filters. */
  readonly filter: 'spell' | 'tag' | 'outcome' | 'kind' | 'reason';

  /** The test stats. */
  readonly stat: StatName;

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** One tag. */
  readonly tag: 'busy';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
  readonly state: never;

  /** The framework's blow. */
  readonly blow: Blow<Game>;

  /** The framework's force. */
  readonly force: Force<Game>;

  /** No game data on auras. */
  readonly data: undefined;

  /** No game fields on auras. */
  readonly ext: undefined;

  /** No aura payloads. */
  readonly payload: undefined;

  /** Aura names are open strings. */
  readonly auraName: string;

  /** Cue names are open strings. */
  readonly cueName: string;

  /** No resources. */
  readonly resource: never;

  /** Two named streams: a sequential one and a keyed one. */
  readonly stream: 'main' | 'crit';

  /** The test host's own services. */
  readonly host: GameHost;

  /** The damage, spell and area trigger systems' kinds. */
  readonly gameProc: DamageProcs<Game> | SpellProcs<Game> | AreaTriggerProcs<Game>;

  /** One damage kind. */
  readonly damageKind: 'physical';

  /** A blow's spell is a spell id. */
  readonly spell: SpellId;

  /** No game fields on a blow. */
  readonly blowExt: undefined;

  /** Spell names are open strings. */
  readonly spellName: string;

  /** The test spell tags. */
  readonly spellTag: 'fire' | 'area' | 'melee';

  /** What a cast is handed: a unit to aim at, or nothing. */
  readonly input: Unit;

  /** Two interrupts. */
  readonly interrupt: 'stun' | 'death';

  /** One game activation kind. */
  readonly gameActivation: Charged;

  /** A cast's game fields: a counter the tests write. */
  readonly castExt: CastFields;

  /** No game data on spells. */
  readonly spellData: undefined;

  /** The game's own reasons a gate refuses a cast. */
  readonly refusal: 'silenced' | 'noRage';

  /** The game's own cast outcome: a charge into a wall. */
  readonly castOutcome: 'blocked';

  /** The game's own end reason: a boss phase clearing its hazards. */
  readonly endReason: 'phase';

  /** Area trigger names are open strings. */
  readonly areaTriggerName: string;

  /** The test area trigger tags. */
  readonly areaTag: 'dome' | 'pool';

  /** What a spawn hands an area trigger: a number its init reads. */
  readonly areaInput: number;

  /** No game fields on area triggers. */
  readonly areaExt: undefined;
}

/** The test stats: a flat power, a multiplier damage bonus, haste, and the target's maximum health. */
export const STATS = defineStats({
  power: { base: 10, kind: 'flat' },
  damage: { base: 1, kind: 'multiplier' },
  abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
  maxHealth: { base: 100, kind: 'flat' },
});

/** The name of a test stat. */
type StatName = keyof typeof STATS.id;

/** The test spell tags. */
export const SPELL_TAGS = defineSpellTags(['fire', 'area', 'melee']);

/** The test area trigger tags. */
export const AREA_TAGS = defineAreaTags(['dome', 'pool']);

/** The test tick slots: the world's, and a late one. */
export const TICK_SLOTS = defineTickSlots(['world', 'late']);

/** `defineSpell` fixed to the test types. */
export const spell = defineSpell<Game>();

/** `defineAura` fixed to the test types. */
export const aura = defineAura<Game>;

/** The test cues: one on the caster, one at a point, one on an entity (an area trigger). */
export const CUES = defineCues({
  cast: defineCue({ anchor: 'self', params: { size: { kind: 'uint8' } } }),
  flash: defineCue({ anchor: 'world' }),
  zone: defineCue({ anchor: 'entity' }),
});

/** The one test damage kind. */
const KINDS = defineDamageKinds({ physical: {} });

/** The test aura tags. */
const TAGS = defineAuraTags(['busy']);

/** The test clock's step: a quarter second, so a second is four steps. */
const STEP = 0.25;

/** The test bus: the four spell events, the area trigger events, the damage, heal and death events, and auras'. */
const makeBus = () =>
  createBus({
    spellStart: (): SpellEvent<Game> => createSpellEvent<Game>(),
    spellRelease: (): SpellEvent<Game> => createSpellEvent<Game>(),
    spellHit: (): SpellEvent<Game> => createSpellEvent<Game>(),
    spellEnd: (): SpellEvent<Game> => createSpellEvent<Game>(),
    areaSpawned: (): AreaTriggerEvent<Game> => createAreaTriggerEvent<Game>(),
    areaEnded: (): AreaTriggerEvent<Game> => createAreaTriggerEvent<Game>(),
    taken: (): DamageEvent<Game> => createDamageEvent<Game>(),
    ignored: (): DamageEvent<Game> => createDamageEvent<Game>(),
    healed: (): HealEvent<Game> => createHealEvent<Game>(),
    death: (): DeathEvent<Game> => createDeathEvent<Game>(),
    aura: (): AuraEvent<Game> => createAuraEvent<Game>(),
  });

/** The test game's bus. */
type TestBus = ReturnType<typeof makeBus>;

/** A test spell game's options. */
export interface SpellGameOptions<Aura extends string, Area extends string = never> {
  /** The game's auras (a cast aura, a listener). */
  readonly auras?: Readonly<Record<Aura, AuraDef<Game>>>;

  /** The game's area trigger kinds. */
  readonly areaTriggers?: Readonly<Record<Area, AnyAreaTriggerDef<Game>>>;

  /** Host overrides. */
  readonly host?: Partial<SpellHost<Game> & AreaTriggerHost<Game>>;

  /** The activation kinds; the framework's own when absent. */
  readonly activations?: ActivationRegistry<Game>;

  /** Spell system overrides. */
  readonly spells?: Partial<Pick<SpellSystemBase<Game>, 'random' | 'streams' | 'slots' | 'world' | 'interrupts'>>;
}

/** A small spell test game. */
export interface SpellGame<Spell extends string, Aura extends string, Area extends string = never> {
  /** The clock. */
  readonly clock: SimClock;

  /** The aura system. */
  readonly auras: AuraSystem<Game>;

  /** The damage system. */
  readonly damage: DamageSystem<Game>;

  /** The proc system. */
  readonly procs: ProcSystem<Game>;

  /** The spell system. */
  readonly spells: SpellSystem<Game>;

  /** The area trigger system, over the two tick slots. */
  readonly areaTriggers: AreaTriggerSystem<Game>;

  /** The world every unit stands in: a memory world with a grid. */
  readonly world: MemoryWorld<Unit>;

  /** The spells. */
  readonly registry: SpellRegistry<Game, Spell>;

  /** The bus. */
  readonly bus: TestBus;

  /** The cue buffer. */
  readonly cues: CueBuffer;

  /** The id of every spell, by name. */
  readonly id: Readonly<Record<Spell, SpellId>>;

  /** The id of every aura, by name. */
  readonly auraId: Readonly<Record<Aura, AuraId>>;

  /** The id of every area trigger kind, by name. */
  readonly areaId: Readonly<Record<Area, AreaTriggerId>>;

  /** What happened, as lines: every spell and area trigger event, and every `mark`. */
  readonly log: string[];

  /** Makes a unit standing at `(id, 0)`, with 100 health and the table's base stats; from id 100, of the other side. */
  readonly unit: (id: number) => Unit;

  /** Moves a unit, in the world too. */
  readonly place: (unit: Unit, at: Vec2) => void;

  /** Steps the clock `count` times (once by default). */
  readonly step: (count?: number) => void;
}

/** A unit's stats as a view: its columns, with the table's bases. */
const viewOf = (unit: Unit): StatView => ({
  total: (stat) => unit.stats[stat] ?? 0,
  base: (stat) => STATS.columns.base[stat] ?? 0,
});

/** A proc that logs a label with the procs' self when it runs (a named `run`). */
export const mark = (label: string): Proc<Game> => ({
  kind: 'run',
  hatch: 'mark',

  fn: (ctx: ProcContext<Game>) => {
    ctx.host.log.push(`${label}@${ctx.self.id}`);
  },
});

/** Logs every spell event, as `start swing@1`, `end swing@1 released`. */
const logEvents = (bus: TestBus, registry: SpellRegistry<Game>, log: string[]): void => {
  const line = (what: string) => (event: SpellEvent<Game>) => {
    const { cast } = event;
    const outcome = event.outcome === undefined ? '' : ` ${event.outcome}`;

    log.push(`${what} ${cast === undefined ? '?' : `${registry.name(cast.spell)}@${cast.caster.id}`}${outcome}`);
  };

  bus.on(bus.kind.spellStart, line('start'));
  bus.on(bus.kind.spellRelease, line('release'));
  bus.on(bus.kind.spellHit, line('hit'));
  bus.on(bus.kind.spellEnd, line('end'));
};

/** Logs every area trigger event, as `spawned pool@1`, `ended pool@1 expired`. */
const logAreaEvents = (bus: TestBus, names: readonly string[], log: string[]): void => {
  const line = (what: string) => (event: AreaTriggerEvent<Game>) => {
    const area = event.areaTrigger;
    const reason = event.reason === undefined ? '' : ` ${event.reason}`;

    log.push(`${what} ${area === undefined ? '?' : `${names[area.kind] ?? '?'}@${area.owner.id}`}${reason}`);
  };

  bus.on(bus.kind.areaSpawned, line('spawned'));
  bus.on(bus.kind.areaEnded, line('ended'));
};

/**
 * Whether a table of auras built from a caller's table holds the names its type says: always, since the caller's table
 * is typed; the check only lets the compiler see it through an optional spread.
 */
const isTable = <Name extends string>(table: object): table is Readonly<Record<Name, AuraDef<Game>>> =>
  typeof table === 'object';

/** Whether a table of area trigger kinds holds the names its type says: always, as for the auras. */
const isAreaTable = <Name extends string>(table: object): Readonly<Record<Name, AnyAreaTriggerDef<Game>>> => {
  if (!isAreas<Name>(table)) {
    throw new TypeError('An area trigger table was lost.');
  }

  return table;
};

/** Whether a table is a table of area trigger kinds by the names its type says: always, since it is typed. */
const isAreas = <Name extends string>(table: object): table is Readonly<Record<Name, AnyAreaTriggerDef<Game>>> =>
  typeof table === 'object';

/** The test game's auras: the given ones, and `busy`, an infinite aura tagged busy. */
const aurasOf = <Aura extends string>(defs: Readonly<Record<Aura, AuraDef<Game>>> | undefined) => {
  const table = { busy: aura({ duration: 'infinite', tags: ['busy'] }), ...defs };

  if (!isTable<Aura | 'busy'>(table)) {
    throw new TypeError('An aura table was lost.');
  }

  return defineAuras<Game, Aura | 'busy'>(table);
};

/**
 * A small spell test game over `defs`: a clock of 0.25 s steps, an aura system, a damage system whose shares come
 * from the spells, a proc system with the core, damage and spell kinds, a trigger system over the four spell events,
 * and the spell system. Its host logs every `mark`; units stand at `(id, 0)`.
 */
export const makeSpellGame = <
  const Spell extends string,
  const Aura extends string = never,
  const Area extends string = never,
>(
  defs: Readonly<Record<Spell, AnySpellDef<Game>>>,
  options: SpellGameOptions<Aura, Area> = {},
): SpellGame<Spell, Aura, Area> => {
  const log: string[] = [];
  const bus = makeBus();
  const clock = createClock({ dt: STEP });
  const auraRegistry = aurasOf(options.auras);

  const registry = defineSpells<Game, Spell>(defs, {
    tags: SPELL_TAGS,
    stats: STATS,
    outcomes: ['blocked'],
    ...(options.activations === undefined ? {} : { activations: options.activations }),
  });

  const areaRegistry = defineAreaTriggers<Game, Area>(options.areaTriggers ?? isAreaTable<Area>({}), {
    tags: AREA_TAGS,
    endReasons: ['phase'],
  });

  const world = createMemoryWorld<Unit>({ bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 }, dt: STEP });
  const cues = createCueBuffer(CUES);
  const views = new WeakMap<Unit, StatView>();
  const late: { procs?: ProcSystem<Game>; spells?: SpellSystem<Game> } = {};

  const auras = createAuraSystem<Game>({
    registry: auraRegistry,
    tags: TAGS,
    clocks: { world: clock },
    host: { run: (list, ctx) => late.procs?.runAura(list, ctx) },
    events: { bus, changed: bus.kind.aura },
  });

  const statsOf = (unit: Unit): StatView => views.get(unit) ?? viewOf(unit);

  const damage = createDamageSystem<Game>({
    auras,
    kinds: KINDS,
    stats: STATS,
    outgoing: ['damage'],
    events: {
      bus,
      taken: bus.kind.taken,
      ignored: bus.kind.ignored,
      healed: bus.kind.healed,
      death: bus.kind.death,
    },
    host: {
      health: (unit) => unit.hp,

      setHealth: (unit, hp) => {
        unit.hp = hp;
      },

      statsOf,
      idOf: (unit) => unit.id,
      shareOf: (spell, stat) => late.spells?.shareOf(spell, stat),
    },
  });

  const host = {
    log,
    idOf: (unit: Unit) => unit.id,
    positionOf: (unit: Unit): Vec2 => unit.at,
    statsOf: (unit: Unit) => statsOf(unit),
    ...options.host,
  };

  const streams = createStreamTable(7, { main: { kind: 'sequential', salt: 1 }, crit: { kind: 'keyed', salt: 2 } });

  const spells: SpellSystem<Game> = createSpellSystem<Game>({
    registry,
    auras,
    procs: (): ProcSystem<Game> => late.procs ?? procs,
    clock,
    host,
    streams: streams.random,
    cues,
    events: {
      bus,
      start: bus.kind.spellStart,
      release: bus.kind.spellRelease,
      hit: bus.kind.spellHit,
      end: bus.kind.spellEnd,
    },
    createExt: () => ({ hits: 0 }),

    resetExt: (ext) => {
      ext.hits = 0;
    },

    ...options.spells,
  });

  const areaTriggers: AreaTriggerSystem<Game> = createAreaTriggerSystem<Game>({
    registry: areaRegistry,
    spells,
    auras,
    procs: (): ProcSystem<Game> => late.procs ?? procs,
    world,
    clock,
    host,
    random: stream(11),
    streams: streams.random,
    cues,
    events: { bus, spawned: bus.kind.areaSpawned, ended: bus.kind.areaEnded },
    slots: TICK_SLOTS,
  });

  const procs: ProcSystem<Game> = createProcSystem<Game>({
    kinds: createProcRegistry<Game>({
      ...CORE_PROCS,
      ...damage.procKinds,
      ...spells.procKinds,
      ...areaTriggers.procKinds,
    }),
    auras,
    host,
    bus,
  });

  late.procs = procs;
  late.spells = spells;

  createTriggerSystem<Game>({
    auras,
    procs,
    bus,
    events: {
      spellStart: spellTriggerEvent(bus.kind.spellStart, registry),
      spellRelease: spellTriggerEvent(bus.kind.spellRelease, registry),
      spellHit: spellTriggerEvent(bus.kind.spellHit, registry),
      spellEnd: spellTriggerEvent(bus.kind.spellEnd, registry),
      areaSpawned: areaTriggerEvent(bus.kind.areaSpawned, areaRegistry),
      areaEnded: areaTriggerEvent(bus.kind.areaEnded, areaRegistry),
    },
  });

  logEvents(bus, registry, log);
  logAreaEvents(bus, areaRegistry.names, log);

  /** A caster, every `auto` spell of the registry armed. */
  const unit = (id: number): Unit => {
    const made: Unit = {
      id,
      at: { x: id, z: 0 },
      hp: 100,
      stats: Float64Array.from(STATS.columns.base),
      auras: auras.createState(),
      casts: spells.createCasterState(),
    };

    views.set(made, viewOf(made));
    world.add(made, { id, at: made.at, radius: 0.5, side: id >= 100 ? 1 : 0 });

    for (const spell of registry.ids) {
      if (registry.get(spell).activation.kind === 'auto') {
        spells.arm(made, spell);
      }
    }

    return made;
  };

  return {
    clock,
    auras,
    damage,
    procs,
    spells,
    registry,
    bus,
    cues,
    areaTriggers,
    world,
    id: registry.id,
    auraId: auraRegistry.id,
    areaId: areaRegistry.id,
    log,
    unit,

    place: (target, at) => {
      target.at = at;
      world.place(target, at);
    },

    step: (count = 1) => {
      for (let i = 0; i < count; i++) {
        clock.step();
      }
    },
  };
};
