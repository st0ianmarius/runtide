import { type AiProcs, createAiSystem, defineTimers } from '../src/ai/index.ts';
import {
  auraGates,
  auraStacks,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../src/auras/index.ts';
import { createClock, stream } from '../src/core/index.ts';
import {
  type Blow,
  createDamageSystem,
  damage,
  type DamageProcs,
  defineDamageKinds,
  type Force,
} from '../src/damage/index.ts';
import { hypot } from '../src/math/index.ts';
import { createModifierSystem, defineSources, defineStats, mul, plus } from '../src/modifiers/index.ts';
import { applyAura, CORE_PROCS, createProcRegistry, createProcSystem, type Proc } from '../src/procs/index.ts';
import type { ScriptTypes } from '../src/scripts/index.ts';
import {
  type AnySpellDef,
  createSpellSystem,
  defineSpells,
  type SpellId,
  type SpellProcs,
  type SpellSystem,
} from '../src/spells/index.ts';
import {
  createUnitSystem,
  defineUnits,
  defineUnitStates,
  defineUnitTags,
  type Unit,
  type UnitProcs,
} from '../src/units/index.ts';

/** The horde game's types: a whole unit game, as swarm's will be. */
interface HordeGame extends ScriptTypes {
  /** A unit. */
  readonly bearer: Unit<HordeGame>;

  /** Procs. */
  readonly proc: Proc<HordeGame>;

  /** No triggers. */
  readonly trigger: never;

  /** Four stats. */
  readonly stat: 'maxHealth' | 'speed' | 'power' | 'armor';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** A unit's bases, then auras. */
  readonly source: 'base' | 'auras';

  /** Three tags. */
  readonly tag: 'stun' | 'root' | 'chill';

  /** One clock. */
  readonly clock: 'world';

  /** The lifecycle's states. */
  readonly state: 'dead' | 'despawned';

  /** The framework's blow. */
  readonly blow: Blow<HordeGame>;

  /** The framework's force. */
  readonly force: Force<HordeGame>;

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

  /** Every system's kinds. */
  readonly gameProc: AiProcs<HordeGame> | DamageProcs<HordeGame> | SpellProcs<HordeGame> | UnitProcs<HordeGame>;

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

  /** A stun. */
  readonly interrupt: 'stun';

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

  /** Two classes. */
  readonly unitTag: 'horde' | 'hero';

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
export const hordeCounter = { seen: 0 };

/** The step, the horde's size, the heroes' and how many mobs die (and are replaced) each tick. */
const DT = 1 / 30;
const MOBS = 2000;
const HEROES = 4;
const DEATHS_PER_TICK = 10;

/** How close a swing reaches, and how fast a mob walks toward its hero. */
const REACH = 1.5;
const WALK = 4 * DT;

const STATS = defineStats({
  maxHealth: { base: 100, kind: 'flat' },
  speed: { base: 5, kind: 'flat' },
  power: { base: 10, kind: 'flat' },
  armor: { base: 0, kind: 'flat' },
});

const TAGS = defineAuraTags(['stun', 'root', 'chill']);
const aura = defineAura<HordeGame>;

/** 116 content auras no unit here holds, each with a modifier: the registry a game of swarm's size carries. */
const CONTENT = Object.fromEntries(
  Array.from({ length: 116 }, (_unused, i) => [
    `content${i}`,
    aura({ duration: 10, modifiers: [i % 2 === 0 ? plus('power', 1) : mul('speed', 1.1)] }),
  ]),
);

const AURAS = defineAuras<HordeGame, string>({
  ...CONTENT,
  haste: aura({ duration: 'infinite', modifiers: [mul('speed', 1.2)] }),
  rage: aura({ duration: 3, modifiers: [mul('power', 1.25)] }),
  chill: aura({ duration: 2, tags: ['chill'], modifiers: [mul('speed', 0.7)] }),
  mark: aura({ duration: 'infinite', removedOn: ['dead', 'despawned'] }),
});

const CLOCK = createClock({ dt: DT });
const SOURCES = defineSources(['base', 'auras']);
const MODIFIERS = createModifierSystem({ stats: STATS, sources: SOURCES, stacks: auraStacks, held: auraGates });

const late: {
  procs?: ReturnType<typeof createProcSystem<HordeGame>>;
  hero?: Unit<HordeGame>;
  swing?: readonly Proc<HordeGame>[];
  spells?: SpellSystem<HordeGame>;
} = {};

/** Throws: a system is wired after the systems that name it. */
const missing = (): never => {
  throw new Error('The horde bench is not wired.');
};

const AURA_SYSTEM = createAuraSystem<HordeGame>({
  registry: AURAS,
  tags: TAGS,
  clocks: { world: CLOCK },
  states: ['dead', 'despawned'],
  modifiers: MODIFIERS,
  fold: 'auras',
  host: { run: (procs, ctx) => late.procs?.runAura(procs, ctx) },
});

/** Each mob's position, by entity id, and the distance to its hero this tick (what the game measured to steer). */
const X = new Float64Array(8192);
const Z = new Float64Array(8192);
const GAP = new Float64Array(8192);

/** 36 more spells no mob casts, beside the swing and the four a mob picks from: a swarm-sized spell registry. */
const OTHER_SPELLS = Object.fromEntries(
  Array.from({ length: 36 }, (_unused, i): [string, AnySpellDef<HordeGame>] => [
    `other${i}`,
    { activation: { kind: 'trigger' }, timeline: { windup: { seconds: 0.5 } }, release: () => undefined },
  ]),
);

/** The swing's interval, which a mob's swing is reset to as its other casts end. */
const SWING_INTERVAL = 1.2;

/** A cast a mob picks: winds up, then enrages it; its swing starts over as it ends. */
const picked = (): AnySpellDef<HordeGame> => ({
  activation: { kind: 'trigger' },
  timeline: { windup: { seconds: 0.5 } },
  release: () => [applyAura<HordeGame>('rage', { to: 'self' })],

  onEnd: (ctx) => {
    late.spells?.setClock(ctx.caster, SPELL_DEFS.id['swing'] ?? missing(), SWING_INTERVAL);

    return undefined;
  },
});

const SPELL_DEFS = defineSpells<HordeGame, string>({
  swing: {
    activation: {
      kind: 'auto',
      interval: SWING_INTERVAL,
      ready: (caster) => (GAP[caster.id] ?? 0) <= REACH && late.spells?.isCasting(caster) !== true,
    },
    target: () => late.hero,
    release: () => late.swing,
  },
  a: picked(),
  b: picked(),
  c: picked(),
  d: picked(),
  ...OTHER_SPELLS,
});

const SPELLS = createSpellSystem<HordeGame>({
  registry: SPELL_DEFS,
  auras: AURA_SYSTEM,
  procs: () => late.procs ?? missing(),
  clock: CLOCK,
  host: {},
});

late.spells = SPELLS;

const TIMERS = defineTimers(['pick']);
const AI = createAiSystem<HordeGame>({ spells: SPELLS, clock: CLOCK, timers: TIMERS });

const TEMPLATES = defineUnits<HordeGame, 'grunt' | 'hero'>(
  {
    grunt: { stats: { speed: 4, maxHealth: 60 }, tags: ['horde'], autoAttack: 'swing' },
    hero: { stats: { maxHealth: 1e12 }, tags: ['hero'] },
  },
  { stats: STATS, tags: defineUnitTags(['horde', 'hero']) },
);

const UNITS = createUnitSystem<HordeGame>({
  registry: TEMPLATES,
  ai: AI,
  auras: AURA_SYSTEM,
  spells: SPELLS,
  modifiers: { system: MODIFIERS, base: 'base' },
  health: { stat: 'maxHealth' },
  states: defineUnitStates(TAGS, {
    stunned: { tags: ['stun'], blocks: ['act', 'move'], interrupt: 'stun' },
    rooted: { tags: ['root'], blocks: ['move'] },
  }),
});

const DAMAGE = createDamageSystem<HordeGame>({
  auras: AURA_SYSTEM,
  kinds: defineDamageKinds({ physical: {} }),
  stats: STATS,
  host: { ...UNITS.damageHost, run: (procs, ctx) => late.procs?.runAura(procs, ctx) },
});

late.procs = createProcSystem<HordeGame>({
  kinds: createProcRegistry<HordeGame>({
    ...CORE_PROCS,
    ...DAMAGE.procKinds,
    ...SPELLS.procKinds,
    ...UNITS.procKinds,
    ...AI.procKinds,
  }),
  auras: AURA_SYSTEM,
  host: { idOf: (unit) => unit.id },
});

/** The draw the picks and the spawn points take. */
const DRAW = stream(9, 31);

/** The pool a mob picks from, and how its picks are made. */
const POOL: readonly SpellId[] = ['a', 'b', 'c', 'd'].map((name) => SPELL_DEFS.id[name] ?? missing());
const WEIGHTS = new Float64Array(SPELL_DEFS.size);

POOL.forEach((spell, i) => {
  WEIGHTS[spell] = i + 1;
});

const PICK = { random: DRAW, weight: (_unit: unknown, spell: SpellId): number => WEIGHTS[spell] ?? 0 };

/** The auras every mob holds from its spawn. */
const HASTE = AURAS.id['haste'] ?? missing();
const MARK = AURAS.id['mark'] ?? missing();

/** The heroes at the centre, and the horde around them. */
const heroes: Unit<HordeGame>[] = [];
const mobs: Unit<HordeGame>[] = [];

/** Spawns a mob on a ring 10–30 m out, hasted and marked, its pick due within 3 s. */
const spawnMob = (): Unit<HordeGame> => {
  const mob = UNITS.spawn(TEMPLATES.id.grunt, { side: 1 });
  const angle = DRAW() * 2 * Math.PI;
  const distance = 10 + 20 * DRAW();

  X[mob.id] = Math.sin(angle) * distance;
  Z[mob.id] = Math.cos(angle) * distance;
  AURA_SYSTEM.apply(mob, HASTE);
  AURA_SYSTEM.apply(mob, MARK);
  AI.start(mob, TIMERS.id.pick, 3 * DRAW());

  return mob;
};

/** Spawns the heroes and the horde, once. */
const setUp = (): void => {
  if (heroes.length > 0) {
    return;
  }

  for (let i = 0; i < HEROES; i++) {
    heroes.push(UNITS.spawn(TEMPLATES.id.hero, { side: 0 }));
  }

  late.hero = heroes[0] ?? missing();
  late.swing = [damage<HordeGame>(5, { to: late.hero }), applyAura<HordeGame>('chill', { to: late.hero })];

  for (let i = 0; i < MOBS; i++) {
    mobs.push(spawnMob());
  }
};

/** A due pick: a spell picked and cast, the timer started again 1 to 3 s away. */
const firePick = (unit: Unit<HordeGame>): void => {
  const spell = AI.pick(unit, POOL, PICK);

  if (spell !== undefined) {
    hordeCounter.seen += SPELLS.cast(unit, spell).went;
  }

  AI.start(unit, TIMERS.id.pick, 1 + 2 * DRAW());
};

/** A mob walks toward the centre until its swing reaches, at its folded speed. */
const walk = (mob: Unit<HordeGame>): void => {
  const { id } = mob;
  const x = X[id] ?? 0;
  const z = Z[id] ?? 0;
  const gap = hypot(x, z);

  if (gap > REACH && UNITS.canMove(mob)) {
    const step = Math.min(gap - REACH, (WALK * UNITS.statsOf(mob).total(STATS.id.speed)) / 4) / gap;

    X[id] = x - x * step;
    Z[id] = z - z * step;
  }

  GAP[id] = hypot(X[id] ?? 0, Z[id] ?? 0);
};

/** The heroes cut down a few mobs, which fall and are replaced at the edge. */
const cull = (): void => {
  const hero = heroes[0] ?? missing();

  for (let i = 0; i < DEATHS_PER_TICK; i++) {
    const index = Math.floor(DRAW() * mobs.length);
    const mob = mobs[index] ?? missing();

    DAMAGE.hit({ target: mob, attacker: hero, amount: 1e6 });
    UNITS.despawn(mob);
    mobs[index] = spawnMob();
  }
};

/** One tick of the whole game: clock, every unit's auras, walk, auto swing and casts, the brains, the deaths. */
const tick = (): void => {
  setUp();
  CLOCK.step();

  for (const hero of heroes) {
    AURA_SYSTEM.tick(hero, 'world');
    SPELLS.step(hero);
  }

  for (const mob of mobs) {
    AURA_SYSTEM.tick(mob, 'world');
    walk(mob);
    SPELLS.stepAuto(mob);
    SPELLS.step(mob);
  }

  hordeCounter.seen += AI.step(firePick);
  SPELLS.stepDelayed();
  cull();
};

/** What the horde did so far: the swings that landed on the lead hero, and the mobs within reach of it now. */
export const hordeStats = (): { readonly swings: number; readonly inReach: number } => {
  const hero = heroes[0];

  return {
    swings: hero === undefined ? 0 : Math.round((hero.maxHealth - hero.health) / 5),
    inReach: mobs.filter((mob) => (GAP[mob.id] ?? 0) <= REACH).length,
  };
};

/** The whole-game benchmark task, and how many operations each call of its function is. */
export const HORDE_TASKS: readonly (readonly [string, () => void, number])[] = [
  ['horde: 2,000 mobs + 4 heroes, the whole unit game (tick)', tick, 1],
];
