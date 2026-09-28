import {
  type AuraDef,
  type AuraId,
  type AuraState,
  type AuraSystem,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../../src/auras/index.ts';
import { createBus, createClock, createStreamTable, type SimClock } from '../../src/core/index.ts';
import { createCueBuffer, type CueBuffer, defineCue, defineCues } from '../../src/cues/index.ts';
import {
  type Blow,
  createDamageSystem,
  type DamageProcs,
  type DamageSystem,
  type DamageTypes,
  defineDamageKinds,
  type Force,
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
  type SpellTypes,
} from '../../src/spells/index.ts';
import { createTriggerSystem, type TriggerDef, type TriggerTypes } from '../../src/triggers/index.ts';

/** A test unit: an entity id, a place, health, a stat column per stat, its auras and its casts. */
export interface Unit extends SpellCaster {
  /** Its entity id. */
  readonly id: number;

  /** Where it stands. */
  readonly at: Vec2;

  /** Its health. */
  hp: number;

  /** Its stat totals, by stat id (the tests write them directly). */
  readonly stats: Float64Array;

  /** Its auras. */
  readonly auras: AuraState;

  /** Its casts. */
  readonly casts: CasterState;
}

/** The test game's own activation kind (§I.5.6 hatch 2): a cast that needs at least some rank. */
export interface Charged extends ActivationShape {
  /** The discriminant. */
  readonly kind: 'charged';

  /** The lowest rank that may cast. */
  readonly least: number;
}

/** The test game's own host services. */
export interface GameHost {
  /** What happened, as lines. */
  readonly log: string[];
}

/** A cast's game fields (§I.5.6 hatch 4). */
export interface CastFields {
  /** A counter the tests write. */
  hits: number;
}

/** The test game's types. */
export interface Game extends SpellTypes, DamageTypes, TriggerTypes {
  /** A test unit. */
  readonly bearer: Unit;

  /** The game's procs. */
  readonly proc: Proc<Game>;

  /** The game's triggers. */
  readonly trigger: TriggerDef<Game>;

  /** The spell events, as trigger events. */
  readonly event: 'spellStart' | 'spellRelease' | 'spellHit' | 'spellEnd';

  /** The spell trigger events' filters. */
  readonly filter: 'spell' | 'tag' | 'outcome';

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

  /** The damage and spell systems' kinds. */
  readonly gameProc: DamageProcs<Game> | SpellProcs<Game>;

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

/** `defineSpell` fixed to the test types. */
export const spell = defineSpell<Game>();

/** `defineAura` fixed to the test types. */
export const aura = defineAura<Game>;

/** The test cues: one on the caster, one at a point. */
export const CUES = defineCues({
  cast: defineCue({ anchor: 'self', params: { size: { kind: 'uint8' } } }),
  flash: defineCue({ anchor: 'world' }),
});

/** The one test damage kind. */
const KINDS = defineDamageKinds({ physical: {} });

/** The test aura tags. */
const TAGS = defineAuraTags(['busy']);

/** The test clock's step: a quarter second, so a second is four steps. */
export const STEP = 0.25;

/** The test bus: the four spell events. */
const makeBus = () =>
  createBus({
    spellStart: (): SpellEvent<Game> => createSpellEvent<Game>(),
    spellRelease: (): SpellEvent<Game> => createSpellEvent<Game>(),
    spellHit: (): SpellEvent<Game> => createSpellEvent<Game>(),
    spellEnd: (): SpellEvent<Game> => createSpellEvent<Game>(),
  });

/** The test game's bus. */
type TestBus = ReturnType<typeof makeBus>;

/** A test spell game's options. */
export interface SpellGameOptions<Aura extends string> {
  /** The game's auras (a cast aura, a listener). */
  readonly auras?: Readonly<Record<Aura, AuraDef<Game>>>;

  /** Host overrides. */
  readonly host?: Partial<SpellHost<Game>>;

  /** The activation kinds; the framework's own when absent. */
  readonly activations?: ActivationRegistry<Game>;

  /** Spell system overrides. */
  readonly spells?: Partial<Pick<SpellSystemBase<Game>, 'random' | 'streams' | 'slots'>>;
}

/** A small spell test game. */
export interface SpellGame<Spell extends string, Aura extends string> {
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

  /** What happened, as lines: every spell event, and every `mark`. */
  readonly log: string[];

  /** Makes a unit standing at `(id, 0)`, with 100 health and the table's base stats. */
  readonly unit: (id: number) => Unit;

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

/**
 * Whether a table of auras built from a caller's table holds the names its type says: always, since the caller's table
 * is typed; the check only lets the compiler see it through an optional spread.
 */
const isTable = <Name extends string>(table: object): table is Readonly<Record<Name, AuraDef<Game>>> =>
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
export const makeSpellGame = <const Spell extends string, const Aura extends string = never>(
  defs: Readonly<Record<Spell, AnySpellDef<Game>>>,
  options: SpellGameOptions<Aura> = {},
): SpellGame<Spell, Aura> => {
  const log: string[] = [];
  const bus = makeBus();
  const clock = createClock({ dt: STEP });
  const auraRegistry = aurasOf(options.auras);

  const registry = defineSpells<Game, Spell>(defs, {
    tags: SPELL_TAGS,
    stats: STATS,
    ...(options.activations === undefined ? {} : { activations: options.activations }),
  });

  const cues = createCueBuffer(CUES);
  const views = new WeakMap<Unit, StatView>();
  const late: { procs?: ProcSystem<Game>; spells?: SpellSystem<Game> } = {};

  const auras = createAuraSystem<Game>({
    registry: auraRegistry,
    tags: TAGS,
    clocks: { world: clock },
    host: { run: (list, ctx) => late.procs?.runAura(list, ctx) },
  });

  const statsOf = (unit: Unit): StatView => views.get(unit) ?? viewOf(unit);

  const damage = createDamageSystem<Game>({
    auras,
    kinds: KINDS,
    stats: STATS,
    outgoing: ['damage'],
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

  const procs: ProcSystem<Game> = createProcSystem<Game>({
    kinds: createProcRegistry<Game>({ ...CORE_PROCS, ...damage.procKinds, ...spells.procKinds }),
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
    },
  });

  logEvents(bus, registry, log);

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
    id: registry.id,
    auraId: auraRegistry.id,
    log,
    unit,

    step: (count = 1) => {
      for (let i = 0; i < count; i++) {
        clock.step();
      }
    },
  };
};
