import { type AiProcs, defineTimers, setTimer } from '../../src/ai/index.ts';
import {
  type AnyAreaTriggerDef,
  type AreaTriggerProcs,
  type AreaTriggerTypes,
  defineAreaTriggers
} from '../../src/area-triggers/index.ts';
import { auraGates, auraRevision, auraStacks, defineAura, defineAuras, defineAuraTags } from '../../src/auras/index.ts';
import { toId } from '../../src/core/ids.ts';
import { createBus, createClock, createStreamTable } from '../../src/core/index.ts';
import { type Blow, damage, type DamageProcs, defineDamageKinds, type Force } from '../../src/damage/index.ts';
import { createGame, type Game, type GameSpec } from '../../src/game/index.ts';
import { circle } from '../../src/math/index.ts';
import { defineSources, defineStats, mul } from '../../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, type Proc } from '../../src/procs/index.ts';
import { defineBehaviour, defineScripts, type ScriptTypes } from '../../src/scripts/index.ts';
import {
  after,
  castSpell,
  defineSpells,
  type SpellId,
  type SpellProcs,
  type SpellRegistry
} from '../../src/spells/index.ts';
import {
  createUnitEvent,
  defineUnits,
  defineUnitStates,
  defineUnitTags,
  type Unit,
  type UnitEvent,
  type UnitProcs
} from '../../src/units/index.ts';

/** The test game's types: units with scripts, area triggers, a memory world. */
export interface TestGame extends ScriptTypes, AreaTriggerTypes {
  /** A unit. */
  readonly bearer: Unit<TestGame>;

  /** The framework's procs. */
  readonly proc: Proc<TestGame>;

  /** No triggers. */
  readonly trigger: never;

  /** Three stats. */
  readonly stat: 'maxHealth' | 'speed' | 'power';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** Bases, then auras. */
  readonly source: 'base' | 'auras';

  /** A stun. */
  readonly tag: 'stun';

  /** One clock. */
  readonly clock: 'world';

  /** The lifecycle's states. */
  readonly state: 'dead' | 'despawned';

  /** The framework's blow. */
  readonly blow: Blow<TestGame>;

  /** The framework's force. */
  readonly force: Force<TestGame>;

  /** No aura data. */
  readonly data: undefined;

  /** No aura fields. */
  readonly ext: undefined;

  /** No payloads. */
  readonly payload: undefined;

  /** Open aura names. */
  readonly auraName: string;

  /** Open cue names. */
  readonly cueName: string;

  /** No resources. */
  readonly resource: never;

  /** The procs' stream. */
  readonly stream: 'procs';

  /** No game services. */
  readonly host: object;

  /** Every system's kinds. */
  readonly gameProc:
    | AiProcs<TestGame>
    | AreaTriggerProcs<TestGame>
    | DamageProcs<TestGame>
    | SpellProcs<TestGame>
    | UnitProcs<TestGame>;

  /** One damage kind. */
  readonly damageKind: 'physical';

  /** A blow's spell is a spell id. */
  readonly spell: SpellId;

  /** No blow fields. */
  readonly blowExt: undefined;

  /** Open spell names. */
  readonly spellName: string;

  /** No spell tags. */
  readonly spellTag: never;

  /** No input. */
  readonly input: undefined;

  /** A stun. */
  readonly interrupt: 'stun';

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** No cast fields. */
  readonly castExt: undefined;

  /** No spell data. */
  readonly spellData: undefined;

  /** No slots. */
  readonly slot: never;

  /** Open unit names. */
  readonly unitName: string;

  /** Two classes. */
  readonly unitTag: 'horde' | 'hero';

  /** A stunned state. */
  readonly unitState: 'stunned';

  /** No unit fields. */
  readonly unitExt: undefined;

  /** One timer. */
  readonly timerName: 'pick';

  /** Open script names. */
  readonly scriptName: string;

  /** No script events. */
  readonly scriptEvents: object;

  /** Open area names. */
  readonly areaTriggerName: string;

  /** No area tags. */
  readonly areaTag: never;

  /** No area input. */
  readonly areaInput: undefined;

  /** No area fields. */
  readonly areaExt: undefined;

  /** No end reasons of the game's. */
  readonly endReason: never;
}

/** The test stats. */
export const STATS = defineStats({
  maxHealth: { base: 100, kind: 'flat' },
  speed: { base: 1, kind: 'flat' },
  power: { base: 10, kind: 'flat' }
});

/** The test aura tags. */
export const TAGS = defineAuraTags(['stun']);

const aura = defineAura<TestGame>;

/** The test auras: a stun and a haste. */
export const AURAS = defineAuras<TestGame, 'stun' | 'haste'>({
  stun: aura({ duration: 1, tags: ['stun'] }),
  haste: aura({ duration: 'infinite', modifiers: [mul('speed', 1.5)] })
});

/** What a test game's hooks read once it is built: its hero, and the game. */
export interface TestRef {
  /** The hero the grunts swing and cast at. */
  hero?: Unit<TestGame>;

  /** The game, which the pool's pulse hits through. */
  game?: Game<TestGame>;
}

/**
 * The test spells: an auto swing at the hero, and a bolt (cancelled by a stun) whose blow lands half a second after
 * its release through a delayed list.
 */
export const spellsOf = (interrupts: boolean, ref: TestRef): SpellRegistry<TestGame, 'swing' | 'bolt'> =>
  defineSpells<TestGame, 'swing' | 'bolt'>({
    swing: {
      activation: { kind: 'auto', interval: 1 },
      target: () => ref.hero,
      release: () => (ref.hero === undefined ? undefined : [damage<TestGame>(3, { to: ref.hero })])
    },
    bolt: {
      activation: { kind: 'trigger' },
      target: () => ref.hero,
      timeline: { windup: { seconds: 0.5 }, ...(interrupts ? { interrupts: { stun: 'cancel' } } : {}) },
      release: () =>
        ref.hero === undefined ? undefined : [after<TestGame>(0.5, [damage<TestGame>(7, { to: ref.hero })])]
    }
  });

/** The test unit tags. */
const UNIT_TAGS = defineUnitTags(['horde', 'hero']);

/** The test templates: a hero, and a grunt that swings and runs the brute script. */
export const TEMPLATES = defineUnits<TestGame, 'hero' | 'grunt'>(
  {
    hero: { stats: { maxHealth: 1e6 }, tags: ['hero'] },
    grunt: { stats: { maxHealth: 40 }, tags: ['horde'], autoAttack: 'swing', script: 'brute' }
  },
  { stats: STATS, tags: UNIT_TAGS }
);

/** The test unit states: a stun keeps a unit from acting and moving, and interrupts its casts. */
export const STATES = defineUnitStates(TAGS, {
  stunned: { tags: ['stun'], blocks: ['act', 'move'], interrupt: 'stun' }
});

/** The AI timers. */
export const TIMERS = defineTimers(['pick']);

const behaviour = defineBehaviour<TestGame>();

/** The brute: picks every second, casting its bolt. */
const SCRIPTS = defineScripts<TestGame, 'brute'>({
  brute: [
    behaviour({
      spawn: () => [setTimer<TestGame>('pick', 1)],
      timer: () => [castSpell<TestGame>('bolt'), setTimer<TestGame>('pick', 1)]
    })
  ]
});

/** The test area triggers: a pool that hits every foe of its owner standing in it each half second. */
const areasOf = (ref: TestRef) =>
  defineAreaTriggers<TestGame, 'pool'>({
    pool: {
      shape: circle(3),
      lifetime: 4,
      every: [
        {
          seconds: 0.5,

          onPulse: (c, hit) => {
            for (const target of hit.targets) {
              ref.game?.damage.hit({ target, attacker: c.owner, amount: 6 });
            }

            return undefined;
          }
        }
      ]
    } satisfies AnyAreaTriggerDef<TestGame>
  });

/** Throws: the test game has area triggers. */
const noAreas = (): never => {
  throw new Error('The test game has area triggers.');
};

/** The test bus: the unit events. */
const busOf = () =>
  createBus({
    spawned: (): UnitEvent<TestGame> => createUnitEvent<TestGame>(),
    changed: (): UnitEvent<TestGame> => createUnitEvent<TestGame>(),
    despawned: (): UnitEvent<TestGame> => createUnitEvent<TestGame>(),
    sideChanged: (): UnitEvent<TestGame> => createUnitEvent<TestGame>()
  });

/** What a test game is built with. */
export interface TestGameOptions {
  /** Whether the bolt's timeline names the stun interrupt; true when absent. */
  readonly interrupts?: boolean;
}

/** A test game built by `createGame`, with a hero and grunts spawned. */
export interface TestWorld {
  /** The game. */
  readonly game: Game<TestGame>;

  /** The hero. */
  readonly hero: Unit<TestGame>;

  /** The grunts. */
  readonly grunts: readonly Unit<TestGame>[];

  /** Spawns a pool at the hero. */
  readonly pool: () => void;
}

/** The spec of a test game over a fresh clock, bus and stream table. */
export const specOf = (options: TestGameOptions, ref: TestRef): GameSpec<TestGame> => {
  const bus = busOf();
  const streams = createStreamTable(7, { procs: { kind: 'sequential', salt: 1 } });
  const clock = createClock({ dt: 0.25 });

  return {
    clock,
    bus,
    streams,
    modifiers: {
      stats: STATS,
      sources: defineSources(['base', 'auras']),
      stacks: auraStacks,
      held: auraGates,
      revision: auraRevision
    },
    auras: { registry: AURAS, tags: TAGS, clocks: { world: clock }, states: ['dead', 'despawned'], fold: 'auras' },
    spells: { registry: spellsOf(options.interrupts ?? true, ref), host: {} },
    ai: { timers: TIMERS },
    world: { memory: { bounds: { minX: -20, minZ: -20, maxX: 20, maxZ: 20 } } },
    areas: { registry: areasOf(ref), host: {} },
    units: {
      registry: TEMPLATES,
      health: { stat: 'maxHealth' },
      states: STATES,
      events: { bus, spawned: bus.kind.spawned, despawned: bus.kind.despawned, sideChanged: bus.kind.sideChanged }
    },
    damage: { kinds: defineDamageKinds({ physical: {} }), stats: STATS },
    procs: {
      kinds: (k) =>
        createProcRegistry<TestGame>({
          ...CORE_PROCS,
          ...k.damage,
          ...k.spells,
          ...k.units,
          ...k.ai,
          ...(k.areas ?? noAreas())
        }),
      host: {},
      random: streams.random('procs')
    },
    scripts: { registry: SCRIPTS, bus, host: {} }
  };
};

/** A test game: a hero at the centre, three grunts around it. */
export const makeTestWorld = (options: TestGameOptions = {}): TestWorld => {
  const ref: TestRef = {};
  const game = createGame(specOf(options, ref));
  const hero = game.units.spawn(TEMPLATES.id.hero, { side: 0, at: { x: 0, z: 0 } });

  ref.game = game;
  ref.hero = hero;

  const grunts = [1, 2, 3].map((i) => game.units.spawn(TEMPLATES.id.grunt, { side: 1, at: { x: i, z: 0 } }));

  return {
    game,
    hero,
    grunts,

    pool: () => {
      game.areas?.spawn(toId<'areaTriggers'>(0), { owner: hero, at: { x: 0, z: 0 } });
    }
  };
};

/** What a test tick does differently, to break it. */
export interface TickFaults {
  /** A unit whose spells are stepped twice. */
  readonly twice?: Unit<TestGame>;

  /** Whether the area triggers are left unstepped. */
  readonly skipAreas?: boolean;

  /** Whether `scripts.collect` is left out (and with it every `scripts.step`). */
  readonly skipCollect?: boolean;
}

/** The units a tick walks, reused. */
const LIST: Unit<TestGame>[] = [];

/** One unit's slot of the tick: its auras, its script, its auto clocks and its casts (twice, when the faults say). */
const stepUnit = (game: Game<TestGame>, unit: Unit<TestGame>, faults: TickFaults): void => {
  game.auras.tickAll(unit);

  if (faults.skipCollect !== true) {
    game.scripts?.step(unit);
  }

  game.spells.stepAuto(unit);
  game.spells.step(unit);

  if (unit === faults.twice) {
    game.spells.step(unit);
  }
};

/** Every tick slot of the area triggers (unless the faults skip them), then of the delayed lists. */
const stepSlots = (game: Game<TestGame>, faults: TickFaults): void => {
  const { areas, spells } = game;
  const areaSlots = faults.skipAreas === true || areas === undefined ? 0 : areas.slots;

  for (let slot = 0; slot < areaSlots; slot++) {
    areas?.step(toId<'tickSlots'>(slot));
  }

  for (let slot = 0; slot < spells.delayedSlots; slot++) {
    spells.stepDelayed(toId<'tickSlots'>(slot));
  }
};

/**
 * One tick in the order `Game` documents: the clock, the world, the scripts' collect, each unit's auras, script,
 * auto and casts, the area triggers' and delayed lists' slots, then the dead despawned.
 */
export const tick = (game: Game<TestGame>, faults: TickFaults = {}): void => {
  const { clock, memoryWorld, scripts, units } = game;

  clock.step();
  memoryWorld?.tick();

  if (faults.skipCollect !== true) {
    scripts?.collect();
  }

  const count = units.list(LIST);

  for (let i = 0; i < count; i++) {
    const unit = LIST[i];

    if (unit !== undefined) {
      stepUnit(game, unit, faults);
    }
  }

  stepSlots(game, faults);

  for (let i = 0; i < count; i++) {
    const unit = LIST[i];

    if (unit?.lifecycle === 'dead') {
      units.despawn(unit);
    }
  }
};
