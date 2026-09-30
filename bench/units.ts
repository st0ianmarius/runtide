import { createAiSystem, defineTimers } from '../src/ai/index.ts';
import {
  auraGates,
  auraStacks,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../src/auras/index.ts';
import { createClock, stream } from '../src/core/index.ts';
import { createModifierSystem, defineSources, defineStats, mul } from '../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem, type Proc } from '../src/procs/index.ts';
import {
  createScriptSystem,
  defineBehaviour,
  defineScripts,
  type ScriptSystem,
  type ScriptTypes,
} from '../src/scripts/index.ts';
import { createSpellSystem, defineSpells, type SpellId, type SpellProcs } from '../src/spells/index.ts';
import { createUnitSystem, defineUnits, defineUnitStates, defineUnitTags, type Unit } from '../src/units/index.ts';

/** The bench game's types. */
interface BenchGame extends ScriptTypes {
  /** A unit. */
  readonly bearer: Unit<BenchGame>;

  /** Procs. */
  readonly proc: Proc<BenchGame>;

  /** No triggers. */
  readonly trigger: never;

  /** Three stats. */
  readonly stat: 'maxHealth' | 'speed' | 'power';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** A unit's bases, then auras. */
  readonly source: 'base' | 'auras';

  /** Two tags. */
  readonly tag: 'stun' | 'root';

  /** One clock. */
  readonly clock: 'world';

  /** No bearer states. */
  readonly state: never;

  /** No blows. */
  readonly blow: never;

  /** No forces. */
  readonly force: never;

  /** No game data. */
  readonly data: undefined;

  /** No game fields. */
  readonly ext: undefined;

  /** No payloads. */
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

  /** The spell kinds. */
  readonly gameProc: SpellProcs<BenchGame>;

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

  /** No interrupts. */
  readonly interrupt: never;

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** No game fields on a cast. */
  readonly castExt: undefined;

  /** No game data on spells. */
  readonly spellData: undefined;

  /** No slots. */
  readonly slot: never;

  /** Open unit names. */
  readonly unitName: string;

  /** One class. */
  readonly unitTag: 'horde';

  /** Two derived states. */
  readonly unitState: 'stunned' | 'rooted';

  /** No game fields on a unit. */
  readonly unitExt: undefined;

  /** One timer. */
  readonly timerName: 'pick';

  /** Open script names. */
  readonly scriptName: string;

  /** No script events. */
  readonly scriptEvents: object;
}

/** How many results the bench read, so no call is optimised away. */
export const unitCounter = { seen: 0 };

const STATS = defineStats({
  maxHealth: { base: 100, kind: 'flat' },
  speed: { base: 5, kind: 'flat' },
  power: { base: 10, kind: 'flat' },
});

const TAGS = defineAuraTags(['stun', 'root']);
const aura = defineAura<BenchGame>;

const AURAS = defineAuras<BenchGame, 'haste'>({
  haste: aura({ duration: 'infinite', modifiers: [mul('speed', 1.5)] }),
});

const CLOCK = createClock({ dt: 1 / 30 });
const SOURCES = defineSources(['base', 'auras']);
const MODIFIERS = createModifierSystem({ stats: STATS, sources: SOURCES, stacks: auraStacks, held: auraGates });

const AURA_SYSTEM = createAuraSystem<BenchGame>({
  registry: AURAS,
  tags: TAGS,
  clocks: { world: CLOCK },
  modifiers: MODIFIERS,
  fold: 'auras',
});

const late: { procs?: ReturnType<typeof createProcSystem<BenchGame>> } = {};

/** Throws: the proc system is wired after the systems that name it. */
const missing = (): never => {
  throw new Error('The bench proc system is not wired.');
};

/** Four ai spells a brain picks from, weighted 1 to 4. */
const POOL_DEFS = defineSpells<BenchGame, 'a' | 'b' | 'c' | 'd'>({
  a: { activation: { kind: 'ai', windup: 0, weight: 1 }, release: () => undefined },
  b: { activation: { kind: 'ai', windup: 0, weight: 2 }, release: () => undefined },
  c: { activation: { kind: 'ai', windup: 0, weight: 3 }, release: () => undefined },
  d: { activation: { kind: 'ai', windup: 0, weight: 4 }, release: () => undefined },
});

const SPELLS = createSpellSystem<BenchGame>({
  registry: POOL_DEFS,
  auras: AURA_SYSTEM,
  procs: () => late.procs ?? missing(),
  clock: CLOCK,
  host: {},
});

late.procs = createProcSystem<BenchGame>({
  kinds: createProcRegistry<BenchGame>({ ...CORE_PROCS, ...SPELLS.procKinds }),
  auras: AURA_SYSTEM,
  host: {},
});

const TEMPLATES = defineUnits<BenchGame, 'grunt' | 'idler' | 'thinker'>(
  {
    grunt: { stats: { speed: 4, maxHealth: 60 }, tags: ['horde'] },
    idler: { tags: ['horde'], script: 'idle' },
    thinker: { tags: ['horde'], script: 'picker' },
  },
  { stats: STATS, tags: defineUnitTags(['horde']) },
);

const TIMERS = defineTimers(['pick']);
const AI = createAiSystem<BenchGame>({ spells: SPELLS, clock: CLOCK, timers: TIMERS });

const hold: { scripts?: ScriptSystem<BenchGame> } = {};

const UNITS = createUnitSystem<BenchGame>({
  registry: TEMPLATES,
  scripts: () => hold.scripts?.forUnits ?? missing(),
  ai: AI,
  auras: AURA_SYSTEM,
  spells: SPELLS,
  modifiers: { system: MODIFIERS, base: 'base' },
  health: { stat: 'maxHealth' },
  states: defineUnitStates(TAGS, {
    stunned: { tags: ['stun'], blocks: ['act', 'move'] },
    rooted: { tags: ['root'], blocks: ['move'] },
  }),
});

const behaviour = defineBehaviour<BenchGame>();

/** A behaviour that only answers timers, none of which run: a scripted unit with nothing due. */
const idle = behaviour({ timer: () => undefined });

/** A pick every 1–3 s: the timer picks from the pool and starts again. */
const picker = behaviour({
  spawn: (ctx) => {
    AI.start(ctx.unit, TIMERS.id.pick, 1 + 2 * DRAW());

    return undefined;
  },

  timer: (ctx) => {
    unitCounter.seen += AI.pick(ctx.unit, POOL, PICK) ?? 0;
    AI.start(ctx.unit, TIMERS.id.pick, 1 + 2 * DRAW());

    return undefined;
  },
});

const SCRIPTS = createScriptSystem<BenchGame>({
  registry: defineScripts<BenchGame, 'idle' | 'picker'>({ idle: [idle], picker: [picker] }),
  ai: AI,
  procs: () => late.procs ?? missing(),
  bus: { on: () => () => undefined },
  host: {},
});

hold.scripts = SCRIPTS;

const GRUNT = UNITS.spawn(TEMPLATES.id.grunt, { side: 1 });

AURA_SYSTEM.apply(GRUNT, AURAS.id.haste);

/** The pool, in id order. */
const POOL: readonly SpellId[] = [POOL_DEFS.id.a, POOL_DEFS.id.b, POOL_DEFS.id.c, POOL_DEFS.id.d];

/** The draw the picks take. */
const DRAW = stream(5, 17);

/** How every bench pick is made. */
const PICK = { random: DRAW };

/** The script benches' crowds, each of 2,000 units, spawned on first use. */
const CROWDS = new Map<'plain' | 'idle' | 'thinker', Unit<BenchGame>[]>();

/** A crowd of 2,000 units of one kind, spawned once. */
const crowd = (kind: 'plain' | 'idle' | 'thinker'): readonly Unit<BenchGame>[] => {
  const made = CROWDS.get(kind);

  if (made !== undefined) {
    return made;
  }

  const template = { plain: TEMPLATES.id.grunt, idle: TEMPLATES.id.idler, thinker: TEMPLATES.id.thinker }[kind];
  const units = Array.from({ length: 2000 }, () => UNITS.spawn(template, { side: 1 }));

  CROWDS.set(kind, units);

  return units;
};

/** Whether the horde of thinking grunts was spawned (on the tick task's first run, so the spawn row runs without it). */
const horde = { isSpawned: false };

/** Spawns 2,000 grunts, each with a pick timer due within the next 3 s, once. */
const spawnHorde = (): void => {
  if (horde.isSpawned) {
    return;
  }

  horde.isSpawned = true;

  for (let i = 0; i < 2000; i++) {
    AI.start(UNITS.spawn(TEMPLATES.id.grunt, { side: 1 }), TIMERS.id.pick, (i % 90) / 30);
  }
};

/** A due pick: a spell picked, the timer started again 1 to 3 s away. */
const firePick = (unit: Unit<BenchGame>): void => {
  unitCounter.seen += AI.pick(unit, POOL, PICK) ?? 0;
  AI.start(unit, TIMERS.id.pick, 1 + 2 * DRAW());
};

/** The F13 unit, F17 AI and F19 script benchmark tasks, and how many operations each call of its function is. */
export const UNIT_TASKS: readonly (readonly [string, () => void, number])[] = [
  [
    'units: spawn + despawn a grunt (template stats)',
    () => {
      const unit = UNITS.spawn(TEMPLATES.id.grunt, { side: 1 });

      unitCounter.seen += unit.health > 0 ? 1 : 0;
      UNITS.despawn(unit);
    },
    1,
  ],
  [
    'scripts: step 2,000 unscripted grunts (tick)',
    () => {
      const units = crowd('plain');

      for (const unit of units) {
        SCRIPTS.step(unit);
      }
    },
    1,
  ],
  [
    'scripts: step 2,000 scripted units, nothing due (tick)',
    () => {
      const units = crowd('idle');

      for (const unit of units) {
        SCRIPTS.step(unit);
      }
    },
    1,
  ],
  [
    'scripts: collect + step 2,000 thinkers, a pick every 1–3 s (tick)',
    () => {
      const units = crowd('thinker');

      CLOCK.step();
      unitCounter.seen += SCRIPTS.collect();

      for (const unit of units) {
        SCRIPTS.step(unit);
      }
    },
    1,
  ],
  [
    'ai: 2,000 brains, a pick timer each every 1–3 s (tick)',
    () => {
      spawnHorde();
      CLOCK.step();
      unitCounter.seen += AI.step(firePick);
    },
    1,
  ],
  [
    'ai: a weighted pick of 4 spells (checked)',
    () => {
      unitCounter.seen += AI.pick(GRUNT, POOL, PICK) ?? 0;
    },
    1,
  ],
  [
    'units: canAct + canMove',
    () => {
      unitCounter.seen += UNITS.canAct(GRUNT) && UNITS.canMove(GRUNT) ? 1 : 0;
    },
    1,
  ],
  [
    'units: a folded stat (an aura modifier)',
    () => {
      unitCounter.seen += UNITS.statsOf(GRUNT).total(STATS.id.speed) > 0 ? 1 : 0;
    },
    1,
  ],
];
