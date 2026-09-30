import { type AiProcs, type AiSystem, createAiSystem, defineTimers } from '../../src/ai/index.ts';
import {
  type AuraApplication,
  type AuraDecision,
  auraGates,
  type AuraId,
  auraStacks,
  type AuraSystem,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../../src/auras/index.ts';
import { createBus, createClock, type SimClock, stream } from '../../src/core/index.ts';
import {
  type Blow,
  createDamageSystem,
  createDeathEvent,
  type DamageProcs,
  type DamageSystem,
  type DeathEvent,
  defineDamageKinds,
  type Force,
} from '../../src/damage/index.ts';
import { createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem, type Proc, type ProcSystem } from '../../src/procs/index.ts';
import {
  createScriptSystem,
  defineScripts,
  type ScriptRegistry,
  type ScriptSystem,
  type ScriptTypes,
} from '../../src/scripts/index.ts';
import {
  type AnySpellDef,
  createSpellSystem,
  defineSpells,
  type SpellId,
  type SpellProcs,
  type SpellSystem,
} from '../../src/spells/index.ts';
import {
  type AuraRule,
  createUnitEvent,
  createUnitSystem,
  defineUnits,
  defineUnitStates,
  defineUnitTags,
  type HealthPolicy,
  type Unit,
  type UnitDef,
  type UnitEvent,
  type UnitId,
  type UnitProcs,
  type UnitSystem,
} from '../../src/units/index.ts';
import type { WorldQuery } from '../../src/world/index.ts';

/** The unit test game's types. */
export interface UnitGame extends ScriptTypes {
  /** A unit of the unit system. */
  readonly bearer: Unit<UnitGame>;

  /** The game's procs. */
  readonly proc: Proc<UnitGame>;

  /** No triggers. */
  readonly trigger: never;

  /** The test stats. */
  readonly stat: 'maxHealth' | 'speed' | 'power';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** A unit's base stats, then auras. */
  readonly source: 'base' | 'auras';

  /** The test aura tags. */
  readonly tag: 'stun' | 'root' | 'freeze' | 'slow' | 'freezeImmune';

  /** One clock. */
  readonly clock: 'world';

  /** The lifecycle states auras may be removed on. */
  readonly state: 'downed' | 'dead' | 'despawned';

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

  /** The damage and spell kinds. */
  readonly gameProc: AiProcs<UnitGame> | DamageProcs<UnitGame> | SpellProcs<UnitGame> | UnitProcs<UnitGame>;

  /** The test timers. */
  readonly timerName: 'pick' | 'raise';

  /** Open script names. */
  readonly scriptName: string;

  /** The events scripts may handle: a lifecycle change and a death. */
  readonly scriptEvents: {
    /** A unit moved between lifecycle states. */
    readonly changed: UnitEvent<UnitGame>;

    /** A unit died. */
    readonly death: DeathEvent<UnitGame>;
  };

  /** One damage kind. */
  readonly damageKind: 'physical';

  /** A blow's spell is a spell id. */
  readonly spell: SpellId;

  /** No game fields on a blow. */
  readonly blowExt: undefined;

  /** Open spell names. */
  readonly spellName: string;

  /** No spell tags. */
  readonly spellTag: never;

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
  readonly unitState: 'stunned' | 'rooted' | 'frozen';

  /** A counter the tests write. */
  readonly unitExt: {
    /** How many times a test marked the unit. */
    marks: number;
  };
}

/** The test timers: a pick gap and a raise. */
export const TIMERS = defineTimers(['pick', 'raise']);

/** The test stats. */
export const STATS = defineStats({
  maxHealth: { base: 100, kind: 'flat' },
  speed: { base: 5, kind: 'flat' },
  power: { base: 10, kind: 'flat' },
});

const aura = defineAura<UnitGame>;

/** The test aura tags. */
export const AURA_TAGS = defineAuraTags(['stun', 'root', 'freeze', 'slow', 'freezeImmune']);

/** The test auras: control, a vigour that raises maximum health, a haste, and a mark gone on death. */
const AURAS = defineAuras<UnitGame, string>({
  stun: aura({ duration: 1, tags: ['stun'] }),
  root: aura({ duration: 2, tags: ['root'] }),
  freeze: aura({ duration: 2, tags: ['freeze'], blockedBy: ['freezeImmune'] }),
  slow: aura({ duration: 2, tags: ['slow'] }),
  freezeImmune: aura({ duration: 1, tags: ['freezeImmune'] }),
  vigour: aura({ duration: 'infinite', modifiers: [plus('maxHealth', 50)] }),
  frail: aura({ duration: 'infinite', modifiers: [mul('maxHealth', 0.5)] }),
  haste: aura({ duration: 'infinite', modifiers: [mul('speed', 2)] }),
  mark: aura({ duration: 'infinite', removedOn: ['dead', 'despawned'] }),
});

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

/**
 * The test derived states: a stun keeps a unit from acting and moving, a root or a freeze from moving; a freeze also
 * makes it frozen, which pauses its casts.
 */
const UNIT_STATES = defineUnitStates(AURA_TAGS, {
  stunned: { tags: ['stun'], blocks: ['act', 'move'], interrupt: 'stun' },
  rooted: { tags: ['root', 'freeze'], blocks: ['move'] },
  frozen: { tags: ['freeze'], interrupt: 'freeze' },
});

/** A unit test game's options. */
export interface UnitGameOptions<Extra extends string = never> {
  /** The health policy. */
  readonly policy?: HealthPolicy<UnitGame>;

  /** The aura application rules. */
  readonly rules?: readonly AuraRule<UnitGame>[];

  /** Whether units fold their stats through the modifier system; true when absent. */
  readonly folds?: boolean;

  /** More spells, beside the swing and the channel. */
  readonly spells?: Readonly<Record<Extra, AnySpellDef<UnitGame>>>;

  /** The scripts templates and spawns name; none when absent. */
  readonly scripts?: ScriptRegistry<UnitGame>;

  /** The world summons are placed in; none when absent. */
  readonly world?: Pick<WorldQuery<Unit<UnitGame>>, 'positionOf' | 'pickPoint'>;
}

/** A small unit test game. */
export interface UnitTestGame<Name extends string, Extra extends string = never> {
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

  /** The proc system, with the unit system's kinds. */
  readonly procs: ProcSystem<UnitGame>;

  /** The id of every template, by name. */
  readonly id: Readonly<Record<Name, UnitId>>;

  /** The id of every spell, by name. */
  readonly spellId: Readonly<Record<'swing' | 'channel' | Extra, SpellId>>;

  /** The script system, with `changed` delivered to the unit's owner and `death` to the unit. */
  readonly scripts: ScriptSystem<UnitGame>;

  /** The AI system, over the pick and raise timers, held by a freeze. */
  readonly ai: AiSystem<UnitGame>;

  /** What happened: every unit event, death and kill, as lines. */
  readonly log: string[];
}

/**
 * A unit test game over `templates`: auras folding through a modifier system (a unit's bases at `base`, auras at
 * `auras`), a spell system with a cast that lasts a second, a damage system whose unit host and force stage are the
 * unit system's, and the unit system over them, logging its events.
 */
export const makeUnitGame = <const Name extends string, const Extra extends string = never>(
  templates: Readonly<Record<Name, UnitDef<UnitGame>>>,
  options: UnitGameOptions<Extra> = {},
): UnitTestGame<Name, Extra> => {
  const log: string[] = [];
  const clock = createClock({ dt: 0.25 });
  const registry = defineUnits<UnitGame, Name>(templates, { stats: STATS, tags: UNIT_TAGS });
  const sources = defineSources(['base', 'auras']);
  const modifiers = createModifierSystem({ stats: STATS, sources, stacks: auraStacks, held: auraGates });

  const late: {
    units?: UnitSystem<UnitGame>;
    policy?: (u: Unit<UnitGame>, a: AuraApplication<UnitGame>) => AuraDecision<UnitGame> | undefined;
  } = {};

  const bus = createBus({
    spawned: (): UnitEvent<UnitGame> => createUnitEvent<UnitGame>(),
    changed: (): UnitEvent<UnitGame> => createUnitEvent<UnitGame>(),
    despawned: (): UnitEvent<UnitGame> => createUnitEvent<UnitGame>(),
    death: (): DeathEvent<UnitGame> => createDeathEvent<UnitGame>(),
    kill: (): DeathEvent<UnitGame> => createDeathEvent<UnitGame>(),
  });

  const auras = createAuraSystem<UnitGame>({
    registry: AURAS,
    tags: AURA_TAGS,
    clocks: { world: clock },
    states: ['downed', 'dead', 'despawned'],
    modifiers,
    fold: 'auras',
    host: {
      onIncomingAura: (unit, application) => late.policy?.(unit, application),
      onTagsChanged: (unit) => late.units?.syncStates(unit),
    },
  });

  const spellRegistry = defineSpells<UnitGame, 'swing' | 'channel' | Extra>({
    ...(options.spells ?? spellTable<Extra>({})),
    swing: { activation: { kind: 'auto', interval: 1 }, release: () => undefined },
    channel: {
      activation: { kind: 'trigger' },
      timeline: { windup: { seconds: 1 }, interrupts: { stun: 'cancel', freeze: 'pause' } },
      release: () => undefined,
    },
  });

  const holder: { procs?: ProcSystem<UnitGame> } = {};

  const spells = createSpellSystem<UnitGame>({
    registry: spellRegistry,
    auras,
    procs: () => holder.procs ?? missing(),
    clock,
    host: { canAct: (unit) => late.units?.canAct(unit) ?? true },
  });

  const ai = createAiSystem<UnitGame>({ spells, clock, timers: TIMERS, heldBy: ['freeze'] });

  const holdScripts: { system?: ScriptSystem<UnitGame> } = {};

  const units = createUnitSystem<UnitGame>({
    scripts: () => holdScripts.system?.forUnits ?? missing(),
    registry,
    auras,
    ai,
    spells,
    ...(options.world === undefined ? {} : { world: options.world }),
    ...(options.folds === false ? {} : { modifiers: { system: modifiers, base: 'base' as const } }),
    health: { stat: 'maxHealth', ...(options.policy === undefined ? {} : { policy: options.policy }) },
    states: UNIT_STATES,
    damage: () => damage,
    events: { bus, spawned: bus.kind.spawned, changed: bus.kind.changed, despawned: bus.kind.despawned },
    createExt: () => ({ marks: 0 }),
  });

  const damage: DamageSystem<UnitGame> = createDamageSystem<UnitGame>({
    auras,
    kinds: defineDamageKinds({ physical: {} }),
    stats: STATS,
    host: {
      ...units.damageHost,

      applyForce: (force) => {
        log.push(`force ${force.target.id} ${force.amount}`);
      },
    },
    forceStages: { traits: units.forceStage },
    events: { bus, death: bus.kind.death, kill: bus.kind.kill },
  });

  const procs = createProcSystem<UnitGame>({
    kinds: createProcRegistry<UnitGame>({
      ...CORE_PROCS,
      ...damage.procKinds,
      ...spells.procKinds,
      ...units.procKinds,
      ...ai.procKinds,
    }),
    auras,
    host: { idOf: (unit) => unit.id },
    random: stream(3),
  });

  holder.procs = procs;
  late.units = units;

  const scripts = createScriptSystem<UnitGame>({
    registry: options.scripts ?? defineScripts<UnitGame, never>({}),
    ai,
    procs,
    bus,
    host: {},
    bindings: {
      changed: { kind: bus.kind.changed, unitOf: (event) => event.unit?.owner },
      death: { kind: bus.kind.death, unitOf: (event) => event.death?.unit },
    },
  });

  holdScripts.system = scripts;
  late.policy = units.auraPolicy(options.rules ?? []);

  const line = (what: string) => (event: UnitEvent<UnitGame>) => {
    log.push(`${what} ${event.unit?.id ?? '?'} ${event.from}>${event.to}`);
  };

  bus.on(bus.kind.spawned, line('spawned'));
  bus.on(bus.kind.changed, line('changed'));
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

  return { clock, auras, spells, damage, units, procs, ai, scripts, id: registry.id, spellId: spellRegistry.id, log };
};

/** Throws: the proc system is wired after the systems that name it. */
const missing = (): never => {
  throw new Error('The test proc system is not wired.');
};

/** A table typed as a table of spells by the names its type says: the empty one when a game adds none. */
const spellTable = <Name extends string>(table: object): Readonly<Record<Name, AnySpellDef<UnitGame>>> => {
  if (!isSpellTable<Name>(table)) {
    throw new TypeError('A spell table was lost.');
  }

  return table;
};

/** Whether a table is a table of spells by the names its type says: always, since it is typed. */
const isSpellTable = <Name extends string>(table: object): table is Readonly<Record<Name, AnySpellDef<UnitGame>>> =>
  typeof table === 'object';
