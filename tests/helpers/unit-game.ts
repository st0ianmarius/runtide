import { type AiProcs, type AiSystem, defineTimers } from '../../src/ai/index.ts';
import {
  type AnyAreaTriggerDef,
  type AreaTriggerId,
  type AreaTriggerProcs,
  type AreaTriggerRegistry,
  type AreaTriggerSystem,
  type AreaTriggerTypes,
  defineAreaTriggers
} from '../../src/area-triggers/index.ts';
import {
  type AuraApplication,
  type AuraDecision,
  type AuraDef,
  auraGates,
  type AuraId,
  auraRevision,
  auraStacks,
  type AuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags
} from '../../src/auras/index.ts';
import { against, defineConditions, defineValues } from '../../src/conditions/index.ts';
import {
  type Bitset,
  createBus,
  createClock,
  createEntityIds,
  type EntityIds,
  type SimClock,
  stream
} from '../../src/core/index.ts';
import {
  type Blow,
  createDeathEvent,
  type DamageProcs,
  type DamageSystem,
  type DeathEvent,
  defineDamageKinds,
  type Force
} from '../../src/damage/index.ts';
import { createGame, type Game, type GameSpec } from '../../src/game/index.ts';
import { circle } from '../../src/math/index.ts';
import { againstValue, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, type Proc, type ProcSystem, run } from '../../src/procs/index.ts';
import { defineScripts, type ScriptRegistry, type ScriptSystem, type ScriptTypes } from '../../src/scripts/index.ts';
import {
  after,
  type AnySpellDef,
  defineSpells,
  defineSpellTags,
  type SpellId,
  type SpellProcs,
  type SpellRegistry,
  type SpellSystem
} from '../../src/spells/index.ts';
import {
  createUnitEvent,
  defineUnits,
  defineUnitStates,
  defineUnitTags,
  type HealthPolicy,
  revive,
  type SpawnUnit,
  type Unit,
  type UnitDef,
  type UnitEvent,
  type UnitId,
  type UnitProcs,
  type UnitRegistry,
  type UnitSystem
} from '../../src/units/index.ts';

/** The unit test game's types. */
export interface UnitGame extends ScriptTypes, AreaTriggerTypes {
  /** A unit of the unit system. */
  readonly bearer: Unit<UnitGame>;

  /** The game's procs. */
  readonly proc: Proc<UnitGame>;

  /** No triggers. */
  readonly trigger: never;

  /** The test stats. */
  readonly stat: 'maxHealth' | 'speed' | 'power' | 'might';

  /** Whether a unit is an elite. */
  readonly condition: 'elite';

  /** A unit's share of its health missing. */
  readonly valueKind: 'missingShare';

  /** A unit's base stats, then auras. */
  readonly source: 'base' | 'auras';

  /** The test aura tags. */
  readonly tag: 'stun' | 'root' | 'freeze' | 'slow' | 'freezeImmune' | 'veil';

  /** One clock. */
  readonly clock: 'world';

  /** The lifecycle states auras may be removed on. */
  readonly state: 'dead' | 'despawned';

  /** The framework's blow. */
  readonly blow: Blow<UnitGame>;

  /** The framework's force. */
  readonly force: Force<UnitGame>;

  /** No game data on auras. */
  readonly data: undefined;

  /** No game fields on auras. */
  readonly ext: undefined;

  /** No aura payloads. */
  readonly payload: undefined;

  /** Open aura names. */
  readonly auraName: string;

  /** Open cue names. */
  readonly cueName: string;

  /** No resources. */
  readonly resource: never;

  /** No named streams. */
  readonly stream: never;

  /** No game services. */
  readonly host: object;

  /** Every system's kinds. */
  readonly gameProc:
    | AiProcs<UnitGame>
    | AreaTriggerProcs<UnitGame>
    | DamageProcs<UnitGame>
    | SpellProcs<UnitGame>
    | UnitProcs<UnitGame>;

  /** The test timers. */
  readonly timerName: 'pick' | 'raise';

  /** Open script names. */
  readonly scriptName: string;

  /** The events scripts may handle: a lifecycle change, a death and a kill. */
  readonly scriptEvents: {
    /** A unit moved between lifecycle states. */
    readonly changed: UnitEvent<UnitGame>;

    /** A unit died. */
    readonly death: DeathEvent<UnitGame>;

    /** A unit killed another. */
    readonly kill: DeathEvent<UnitGame>;
  };

  /** One damage kind. */
  readonly damageKind: 'physical';

  /** A blow's spell is a spell id. */
  readonly spell: SpellId;

  /** No game fields on a blow. */
  readonly blowExt: undefined;

  /** Open spell names. */
  readonly spellName: string;

  /** Tags used by scoped damage modifiers. */
  readonly spellTag: 'attack';

  /** No input. */
  readonly input: undefined;

  /** A stun and a freeze. */
  readonly interrupt: 'stun' | 'freeze';

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** No game fields on a cast. */
  readonly castExt: undefined;

  /** No game data on spells. */
  readonly spellData: undefined;

  /** One slot. */
  readonly slot: 'skill';

  /** Open unit names. */
  readonly unitName: string;

  /** The test unit classes. */
  readonly unitTag: 'horde' | 'elite' | 'boss' | 'objective';

  /** The test derived states. */
  readonly unitState: 'stunned' | 'rooted' | 'frozen' | 'hidden';

  /** What a test spawn may carry: the wave it belongs to. */
  readonly spawnData: {
    /** The wave. */
    readonly wave: number;
  };

  /** A counter the tests write. */
  readonly unitExt: {
    /** How many times a test marked the unit. */
    marks: number;

    /** The template id and side it was made from, and its spawn's wave when it had one. */
    readonly made: string;
  };

  /** Open area trigger names. */
  readonly areaTriggerName: string;

  /** No area trigger tags. */
  readonly areaTag: never;

  /** No area trigger input. */
  readonly areaInput: undefined;

  /** No game fields on area triggers. */
  readonly areaExt: undefined;

  /** No end reasons of the game's. */
  readonly endReason: never;
}

/** The test timers: a pick gap and a raise. */
export const TIMERS = defineTimers(['pick', 'raise']);

/** The test stats. */
export const STATS = defineStats({
  maxHealth: { base: 100, kind: 'flat' },
  speed: { base: 5, kind: 'flat' },
  power: { base: 10, kind: 'flat' },
  might: { base: 1, kind: 'multiplier' }
});

const aura = defineAura<UnitGame>;

/** The test spell scopes. */
export const SPELL_TAGS = defineSpellTags(['attack']);

/** The test aura tags. */
export const AURA_TAGS = defineAuraTags(['stun', 'root', 'freeze', 'slow', 'freezeImmune', 'veil']);

/** The bearer states the test mark heard, as `state id`; a test clears it. */
export const HEARD: string[] = [];

/** A death burst a unit's death schedules: it lands a quarter second later, heard as `burst id` in `HEARD`. */
const burst = (owner: 'none' | undefined) =>
  aura({
    duration: 'infinite',
    removedOn: ['dead'],

    onState: (_ctx, state) =>
      state === 'dead'
        ? [
            after<UnitGame>(
              0.25,
              [
                run<UnitGame>('burst', (ctx) => {
                  HEARD.push(`burst ${ctx.self.id}`);
                })
              ],
              owner === undefined ? {} : { owner }
            )
          ]
        : undefined
  });

/** An aura's modifiers. */
type AuraModifiers = NonNullable<AuraDef<UnitGame>['modifiers']>;

/**
 * The test auras: control, a vigour that raises maximum health, a haste, a brand bound to whoever put it on, a
 * mark that hears states and goes, and death bursts, one unowned and one owned by the dying unit. In a game without a
 * modifier system (`folds` false) the auras that carry modifiers carry none, under the same names and ids.
 */
const aurasOf = (folds: boolean) => {
  const mods = (modifiers: AuraModifiers) => (folds ? { modifiers } : {});

  return defineAuras<UnitGame, string>({
    stun: aura({ duration: 1, tags: ['stun'] }),
    veil: aura({ duration: 3, tags: ['veil'] }),
    root: aura({ duration: 2, tags: ['root'] }),
    freeze: aura({ duration: 2, tags: ['freeze'], blockedBy: ['freezeImmune'] }),
    slow: aura({ duration: 2, tags: ['slow'] }),
    freezeImmune: aura({ duration: 1, tags: ['freezeImmune'] }),
    vigour: aura({ duration: 'infinite', ...mods([plus('maxHealth', 50)]) }),
    frail: aura({ duration: 'infinite', ...mods([mul('maxHealth', 0.5)]) }),
    haste: aura({ duration: 'infinite', ...mods([mul('speed', 2)]) }),
    brand: aura({ duration: 'infinite', boundToSource: true }),
    slayer: aura({ duration: 'infinite', ...mods([mul('might', 1.5, { when: against({ is: 'elite' }) })]) }),
    executioner: aura({ duration: 'infinite', ...mods([plus('might', againstValue('missingShare'))]) }),
    scopedMight: aura({ duration: 'infinite', ...mods([mul('might', 2, { scope: SPELL_TAGS.id.attack })]) }),
    lastStand: aura({
      duration: 'infinite',
      removedOn: ['dead'],
      onState: (_ctx, state) => (state === 'dead' ? [revive<UnitGame>({ to: 'self', health: 50 })] : undefined)
    }),
    burst: burst('none'),
    ownedBurst: burst(undefined),
    mark: aura({
      duration: 'infinite',
      removedOn: ['dead', 'despawned'],

      onState: (ctx, state) => {
        HEARD.push(`${state} ${ctx.bearer.id}`);

        return undefined;
      }
    })
  });
};

/** The test auras of a game that folds stats. */
const AURAS = aurasOf(true);

/** The id of a test aura by name. */
export const auraId = (name: string): AuraId => {
  const id = AURAS.id[name];

  if (id === undefined) {
    throw new RangeError(`no test aura ${name}`);
  }

  return id;
};

/** The test unit classes. */
export const UNIT_TAGS = defineUnitTags(['horde', 'elite', 'boss', 'objective']);

/** The test conditions: whether a unit is an elite. */
const CONDITIONS = defineConditions({ elite: (unit: Unit<UnitGame>) => unit.tags.has(UNIT_TAGS.id.elite) });

/** The test value kinds: a unit's share of its health missing. */
const VALUES = defineValues({ missingShare: (unit: Unit<UnitGame>) => 1 - unit.health / unit.maxHealth });

/**
 * The test derived states: a stun keeps a unit from acting and moving, a root or a freeze from moving; a freeze also
 * makes it frozen, which pauses its casts.
 */
const UNIT_STATES = defineUnitStates(AURA_TAGS, {
  stunned: { tags: ['stun'], blocks: ['act', 'move'], interrupt: 'stun' },
  rooted: { tags: ['root', 'freeze'], blocks: ['move'] },
  frozen: { tags: ['freeze'], interrupt: 'freeze' },
  hidden: { tags: ['veil'], blocks: ['target'] }
});

/**
 * An area trigger kind that lives while its owner does: as its owner dies or despawns (the unit system telling the
 * area triggers `ownerGone`), it ends as `source-gone`, running `onEnd` with the owner.
 */
export const ward = (onEnd: (owner: Unit<UnitGame>) => void): AnyAreaTriggerDef<UnitGame> => ({
  shape: circle(1),
  lifetime: 60,
  bound: { owner: 'present' },

  onEnd: (c) => {
    onEnd(c.owner);

    return undefined;
  }
});

/**
 * A shared id space and a reserve over it that draws the counter past a spawn's own id, so the next id drawn comes
 * after it: what a game whose spawns may name their ids gives the unit system.
 */
export const reserving = (): { readonly ids: EntityIds; readonly reserveId: (id: number) => void } => {
  const ids = createEntityIds();

  return {
    ids,

    reserveId: (id) => {
      while (ids.count() < id) {
        ids.next();
      }
    }
  };
};

/** A unit test game's options. */
export interface UnitGameOptions<Extra extends string = never, Area extends string = never> {
  /** The area trigger kinds; none when absent. */
  readonly areaTriggers?: Readonly<Record<Area, AnyAreaTriggerDef<UnitGame>>>;

  /** The health policy. */
  readonly policy?: HealthPolicy<UnitGame>;

  /** The shared entity id space units draw from; a new one when absent. */
  readonly ids?: EntityIds;

  /** Takes an id a spawn names out of the shared counter's hands; refused when absent. */
  readonly reserveId?: (id: number) => void;

  /** What a living unit whose health `syncHealth` left at 0 does; the damage system's `kill` when absent. */
  readonly onLethal?: (unit: Unit<UnitGame>) => void;

  /** The aura host's application policy, handed the unit system. */
  readonly onIncomingAura?: (
    units: UnitSystem<UnitGame>,
    unit: Unit<UnitGame>,
    application: AuraApplication<UnitGame>
  ) => AuraDecision<UnitGame> | undefined;

  /** Whether the game has a modifier system its auras fold into and its units fold their stats through; true when absent. */
  readonly folds?: boolean;

  /** A custom mapping from damage spells to modifier scopes. */
  readonly scopeOf?: (spell: UnitGame['spell']) => Bitset | undefined;

  /** More spells, beside the swing and the channel. */
  readonly spells?: Readonly<Record<Extra, AnySpellDef<UnitGame>>>;

  /** The scripts templates and spawns name; none when absent. */
  readonly scripts?: ScriptRegistry<UnitGame>;

  /** The unit system's spawn admission (a crowd cap); every spawn may when absent. */
  readonly admit?: (template: UnitId, spawn: SpawnUnit<UnitGame>) => boolean;
}

/** A small unit test game. */
export interface UnitTestGame<Name extends string, Extra extends string = never, Area extends string = never> {
  /** The clock. */
  readonly clock: SimClock;

  /** The aura system. */
  readonly auras: AuraSystem<UnitGame>;

  /** The spell system. */
  readonly spells: SpellSystem<UnitGame>;

  /** The damage system. */
  readonly damage: DamageSystem<UnitGame>;

  /** The unit system. */
  readonly units: UnitSystem<UnitGame>;

  /** The proc system, with every system's kinds. */
  readonly procs: ProcSystem<UnitGame>;

  /** The area trigger system, over the options' kinds, in a memory world that follows the units. */
  readonly areas: AreaTriggerSystem<UnitGame>;

  /** The id of every template, by name. */
  readonly id: Readonly<Record<Name, UnitId>>;

  /** The id of every spell, by name. */
  readonly spellId: Readonly<Record<'swing' | 'channel' | Extra, SpellId>>;

  /** The id of every area trigger kind, by name. */
  readonly areaId: Readonly<Record<Area, AreaTriggerId>>;

  /**
   * The script system, with `changed` delivered to the unit's owner (its `eventUnit` the unit), `death` to the unit,
   * and `kill` to the killer (its `other` the unit killed).
   */
  readonly scripts: ScriptSystem<UnitGame>;

  /** The AI system, over the pick and raise timers, held by a freeze. */
  readonly ai: AiSystem<UnitGame>;

  /** What happened: every unit event, death and kill, as lines. */
  readonly log: string[];

  /** Listens to a unit event, after the log's own listeners. */
  readonly on: (kind: 'spawned' | 'changed' | 'despawned', listener: (event: UnitEvent<UnitGame>) => void) => void;
}

/** The test bus: the unit events, deaths and kills. */
const busOf = () =>
  createBus({
    spawned: (): UnitEvent<UnitGame> => createUnitEvent<UnitGame>(),
    changed: (): UnitEvent<UnitGame> => createUnitEvent<UnitGame>(),
    despawned: (): UnitEvent<UnitGame> => createUnitEvent<UnitGame>(),
    sideChanged: (): UnitEvent<UnitGame> => createUnitEvent<UnitGame>(),
    death: (): DeathEvent<UnitGame> => createDeathEvent<UnitGame>(),
    kill: (): DeathEvent<UnitGame> => createDeathEvent<UnitGame>()
  });

/** The test game's bus. */
type TestBus = ReturnType<typeof busOf>;

/** The swing, the channel, and a game's more spells. */
const spellsOf = <Extra extends string>(extra: Readonly<Record<Extra, AnySpellDef<UnitGame>>> | undefined) =>
  defineSpells<UnitGame, 'swing' | 'channel' | Extra>(
    {
      ...(extra ?? table<Extra, AnySpellDef<UnitGame>>({})),
      swing: { tags: ['attack'], activation: { kind: 'auto', interval: 1 }, release: () => undefined },
      channel: {
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 }, interrupts: { stun: 'cancel', freeze: 'pause' } },
        release: () => undefined
      }
    },
    { tags: SPELL_TAGS }
  );

/** What a test game's hooks read once it is built: the game. */
interface UnitRef {
  /** The game. */
  game?: Game<UnitGame>;
}

/** The parts of a test game's spec that its options and its log shape. */
interface SpecParts {
  /** The unit templates. */
  readonly registry: UnitRegistry<UnitGame>;

  /** The spells. */
  readonly spells: SpellRegistry<UnitGame>;

  /** The area trigger kinds. */
  readonly areas: AreaTriggerRegistry<UnitGame>;

  /** The options. */
  readonly options: UnitGameOptions<string, string>;

  /** The bus. */
  readonly bus: TestBus;

  /** The log the damage host's forces go to. */
  readonly log: string[];

  /** What the hooks read once the game is built. */
  readonly ref: UnitRef;
}

/** The unit system's options: the templates, health, states, events, ext, and the options' ids, admission and scopes. */
const unitsOf = (parts: SpecParts): GameSpec<UnitGame>['units'] => {
  const { registry, options, bus } = parts;

  return {
    registry,
    health: {
      stat: 'maxHealth',
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.onLethal === undefined ? {} : { onLethal: options.onLethal })
    },
    states: UNIT_STATES,
    events: {
      bus,
      spawned: bus.kind.spawned,
      changed: bus.kind.changed,
      despawned: bus.kind.despawned,
      sideChanged: bus.kind.sideChanged
    },

    createExt: (template, spawn) => ({
      marks: 0,
      made: `${template}/${spawn.side}${spawn.data === undefined ? '' : ` wave ${spawn.data.wave}`}`
    }),

    ...(options.scopeOf === undefined ? {} : { scopeOf: options.scopeOf }),
    ...(options.reserveId === undefined ? {} : { reserveId: options.reserveId }),
    ...(options.admit === undefined ? {} : { admit: options.admit })
  };
};

/** The aura host of a test game: the options' application policy, handed the game's unit system. */
const auraHostOf = (options: UnitGameOptions<string, string>, ref: UnitRef) => {
  const policy = options.onIncomingAura;

  return policy === undefined
    ? {}
    : {
        host: {
          onIncomingAura: (unit: Unit<UnitGame>, application: AuraApplication<UnitGame>) =>
            ref.game === undefined ? undefined : policy(ref.game.units, unit, application)
        }
      };
};

/** The spec `createGame` builds a unit test game from. */
const specOf = (parts: SpecParts): GameSpec<UnitGame> => {
  const { options, bus, log, ref } = parts;
  const clock = createClock({ dt: 0.25 });
  const folds = options.folds !== false;

  return {
    clock,
    bus,
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(folds
      ? {
          modifiers: {
            stats: STATS,
            sources: defineSources(['base', 'auras']),
            stacks: auraStacks,
            held: auraGates,
            revision: auraRevision,
            conditions: CONDITIONS,
            values: VALUES
          }
        }
      : {}),
    auras: {
      registry: folds ? AURAS : aurasOf(false),
      tags: AURA_TAGS,
      clocks: { world: clock },
      states: ['dead', 'despawned'],
      ...(folds ? { fold: 'auras' } : {}),
      ...auraHostOf(options, ref)
    },
    spells: { registry: parts.spells, host: {} },
    ai: { timers: TIMERS, holds: ['intro', 'freeze'] },
    world: { memory: { bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 } } },
    areas: { registry: parts.areas, host: {} },
    units: unitsOf(parts),
    damage: {
      kinds: defineDamageKinds({ physical: {} }),
      stats: STATS,
      outgoing: ['might'],
      events: { bus, death: bus.kind.death, kill: bus.kind.kill },
      host: {
        applyForce: (force) => {
          log.push(`force ${force.target.id} ${force.amount}`);
        }
      }
    },
    procs: {
      kinds: (k) =>
        createProcRegistry<UnitGame>({
          ...CORE_PROCS,
          ...k.damage,
          ...k.spells,
          ...k.units,
          ...k.ai,
          ...(k.areas ?? missing('area trigger kinds'))
        }),
      host: {},
      random: stream(3)
    },
    scripts: {
      registry: options.scripts ?? defineScripts<UnitGame, never>({}),
      bus,
      host: {},
      bindings: {
        changed: { kind: bus.kind.changed, unitOf: (event) => event.unit?.owner, eventUnitOf: (event) => event.unit },
        death: { kind: bus.kind.death, unitOf: (event) => event.death?.unit },

        kill: {
          kind: bus.kind.kill,
          unitOf: (event) => event.death?.killer,
          otherOf: (event) => event.death?.unit
        }
      }
    }
  };
};

/** Logs every unit event, death and kill. */
const logEvents = (bus: TestBus, log: string[]): void => {
  const line = (what: string) => (event: UnitEvent<UnitGame>) => {
    log.push(`${what} ${event.unit?.id ?? '?'} ${event.from}>${event.to}`);
  };

  bus.on(bus.kind.spawned, line('spawned'));
  bus.on(bus.kind.changed, line('changed'));
  bus.on(bus.kind.sideChanged, (event) => log.push(`side ${event.unit?.id ?? '?'} ${event.unit?.side ?? '?'}`));
  bus.on(bus.kind.despawned, (event) => {
    line('despawned')(event);

    if (event.reason !== 'despawn') {
      log.push(`reason ${event.reason}`);
    }
  });

  bus.on(bus.kind.spawned, (event) => {
    if (event.at !== undefined) {
      log.push(`at ${event.at.x},${event.at.z}`);
    }
  });
  bus.on(bus.kind.death, (event) => log.push(`death ${event.death?.unit.id ?? '?'}`));
  bus.on(bus.kind.kill, (event) => log.push(`kill by ${event.death?.killer?.id ?? '?'}`));
};

/**
 * A unit test game over `templates`, built by `createGame`: auras folding through a modifier system (a unit's bases at
 * `base`, auras at `auras`), a spell system with a cast that lasts a second, AI held by an intro and a freeze, a
 * damage system whose force stage logs, scripts over a lifecycle change, a death and a kill, area triggers in a memory
 * world that follows the units, and the unit system over them, logging its events.
 */
export const makeUnitGame = <
  const Name extends string,
  const Extra extends string = never,
  const Area extends string = never
>(
  templates: Readonly<Record<Name, UnitDef<UnitGame>>>,
  options: UnitGameOptions<Extra, Area> = {}
): UnitTestGame<Name, Extra, Area> => {
  const log: string[] = [];
  const bus = busOf();
  const ref: UnitRef = {};
  const registry = defineUnits<UnitGame, Name>(templates, { stats: STATS, tags: UNIT_TAGS });
  const spells = spellsOf<Extra>(options.spells);
  const kinds = options.areaTriggers ?? table<Area, AnyAreaTriggerDef<UnitGame>>({});
  const areas = defineAreaTriggers<UnitGame, Area>(kinds);
  const game = createGame(specOf({ registry, spells, areas, options, bus, log, ref }));

  ref.game = game;
  logEvents(bus, log);

  return {
    clock: game.clock,
    auras: game.auras,
    spells: game.spells,
    damage: game.damage,
    units: game.units,
    procs: game.procs,
    areas: game.areas ?? missing('area triggers'),
    ai: game.ai,
    scripts: game.scripts ?? missing('scripts'),
    id: registry.id,
    spellId: spells.id,
    areaId: areas.id,
    log,

    on: (kind, listener) => {
      bus.on(bus.kind[kind], listener);
    }
  };
};

/** Throws: the test game was built without a system it always has. */
const missing = (what: string): never => {
  throw new Error(`The test game has no ${what}.`);
};

/** Whether a table holds the names its type says: always, for the empty table of a game that adds none. */
const isTable = <Name extends string, Value>(value: object): value is Readonly<Record<Name, Value>> =>
  typeof value === 'object';

/** An empty table typed as a table by the names its type says (none, where a game adds none). */
const table = <Name extends string, Value>(value: object): Readonly<Record<Name, Value>> => {
  if (!isTable<Name, Value>(value)) {
    throw new TypeError('A table was lost.');
  }

  return value;
};
