import { type AiProcs, createAiSystem, defineTimers } from '../src/ai/index.ts';
import {
  type AnyAreaTriggerDef,
  type AreaTriggerProcs,
  type AreaTriggerTypes,
  createAreaTriggerSystem,
  defineAreaTriggers,
} from '../src/area-triggers/index.ts';
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
  type BlowSpec,
  createDamageSystem,
  damage,
  type DamageProcs,
  defineDamageKinds,
  type Force,
} from '../src/damage/index.ts';
import { circle, hypot } from '../src/math/index.ts';
import { createModifierSystem, defineSources, defineStats, mul } from '../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem, type Proc } from '../src/procs/index.ts';
import type { ScriptTypes } from '../src/scripts/index.ts';
import { createSpellSystem, defineSpells, type SpellId, type SpellProcs } from '../src/spells/index.ts';
import {
  createUnitSystem,
  defineUnits,
  defineUnitStates,
  defineUnitTags,
  type Unit,
  type UnitProcs,
} from '../src/units/index.ts';
import { createMemoryWorld } from '../src/world/index.ts';

/** The co-op game's types: a whole unit game with area triggers and a world, as swarm's will be. */
interface CoopGame extends ScriptTypes, AreaTriggerTypes {
  readonly bearer: Unit<CoopGame>;
  readonly proc: Proc<CoopGame>;
  readonly trigger: never;
  readonly stat: 'maxHealth' | 'speed' | 'power';
  readonly condition: never;
  readonly valueKind: never;
  readonly source: 'base' | 'auras';
  readonly tag: 'stun' | 'chill';
  readonly clock: 'world';
  readonly state: 'dead' | 'despawned';
  readonly blow: Blow<CoopGame>;
  readonly force: Force<CoopGame>;
  readonly data: undefined;
  readonly ext: undefined;
  readonly payload: undefined;
  readonly auraName: string;
  readonly cueName: string;
  readonly resource: never;
  readonly stream: never;
  readonly host: object;

  readonly gameProc:
    | AiProcs<CoopGame>
    | AreaTriggerProcs<CoopGame>
    | DamageProcs<CoopGame>
    | SpellProcs<CoopGame>
    | UnitProcs<CoopGame>;

  readonly damageKind: 'physical';
  readonly spell: SpellId;
  readonly blowExt: undefined;
  readonly spellName: string;
  readonly spellTag: never;
  readonly input: undefined;
  readonly interrupt: 'stun';
  readonly gameActivation: never;
  readonly castExt: undefined;
  readonly spellData: undefined;
  readonly slot: never;
  readonly unitName: string;
  readonly unitTag: 'horde' | 'hero';
  readonly unitState: 'stunned';
  readonly unitExt: undefined;
  readonly timerName: 'pick';
  readonly scriptName: string;
  readonly scriptEvents: object;
  readonly areaTriggerName: string;
  readonly areaTag: never;
  readonly areaInput: number;
  readonly areaExt: undefined;
  readonly endReason: never;
}

/** How many results the bench read, so no call is optimised away. */
export const coopCounter = { seen: 0 };

/** Swarm's step (60 Hz), its crowd in a busy co-op wave, and the party. */
const DT = 1 / 60;
const MOBS = 350;
const HEROES = 4;

/** How close a swing reaches, and how fast a mob walks at speed 1. */
const REACH = 1.2;
const WALK = 3.5 * DT;

const STATS = defineStats({
  maxHealth: { base: 100, kind: 'flat' },
  speed: { base: 1, kind: 'flat' },
  power: { base: 10, kind: 'flat' },
});

const TAGS = defineAuraTags(['stun', 'chill']);
const aura = defineAura<CoopGame>;

const AURAS = defineAuras<CoopGame, 'haste' | 'chill'>({
  haste: aura({ duration: 'infinite', modifiers: [mul('speed', 1.1)] }),
  chill: aura({ duration: 'infinite', tags: ['chill'], modifiers: [mul('speed', 0.6)] }),
});

const CLOCK = createClock({ dt: DT });
const SOURCES = defineSources(['base', 'auras']);
const MODIFIERS = createModifierSystem({ stats: STATS, sources: SOURCES, stacks: auraStacks, held: auraGates });
const WORLD = createMemoryWorld<Unit<CoopGame>>({ bounds: { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, dt: DT });

/** The blow every hero hit reuses, its target and amount set per hit. */
type ReusedBlow = { -readonly [K in keyof BlowSpec<CoopGame>]: BlowSpec<CoopGame>[K] };

const late: {
  procs?: ReturnType<typeof createProcSystem<CoopGame>>;
  swing?: readonly Proc<CoopGame>[];
  blow?: ReusedBlow;
} = {};

/** Throws: a system is wired after the systems that name it. */
const missing = (): never => {
  throw new Error('The co-op bench is not wired.');
};

const AURA_SYSTEM = createAuraSystem<CoopGame>({
  registry: AURAS,
  tags: TAGS,
  clocks: { world: CLOCK },
  states: ['dead', 'despawned'],
  modifiers: MODIFIERS,
  fold: 'auras',
  host: { run: (procs, ctx) => late.procs?.runAura(procs, ctx) },
});

/** Each unit's hero (the one it walks to) and its distance to it this tick, by entity id. */
const CHASES = new Int32Array(8192);
const GAP = new Float64Array(8192);

const SPELL_DEFS = defineSpells<CoopGame, 'swing'>({
  swing: {
    activation: { kind: 'auto', interval: 1, ready: (caster) => (GAP[caster.id] ?? 0) <= REACH },
    target: (ctx) => heroes[CHASES[ctx.caster.id] ?? 0],
    release: () => late.swing,
  },
});

const SPELLS = createSpellSystem<CoopGame>({
  registry: SPELL_DEFS,
  auras: AURA_SYSTEM,
  procs: () => late.procs ?? missing(),
  clock: CLOCK,
  host: {},
});

const AI = createAiSystem<CoopGame>({ spells: SPELLS, clock: CLOCK, timers: defineTimers(['pick']) });

const TEMPLATES = defineUnits<CoopGame, 'grunt' | 'hero'>(
  {
    grunt: { stats: { maxHealth: 40 }, tags: ['horde'], autoAttack: 'swing' },
    hero: { stats: { maxHealth: 1e12, speed: 1.2 }, tags: ['hero'] },
  },
  { stats: STATS, tags: defineUnitTags(['horde', 'hero']) },
);

const UNITS = createUnitSystem<CoopGame>({
  registry: TEMPLATES,
  ai: AI,
  auras: AURA_SYSTEM,
  spells: SPELLS,
  modifiers: { system: MODIFIERS, base: 'base' },
  health: { stat: 'maxHealth' },
  states: defineUnitStates(TAGS, { stunned: { tags: ['stun'], blocks: ['act', 'move'], interrupt: 'stun' } }),
});

const DAMAGE = createDamageSystem<CoopGame>({
  auras: AURA_SYSTEM,
  kinds: defineDamageKinds({ physical: {} }),
  stats: STATS,
  host: { ...UNITS.damageHost, run: (procs, ctx) => late.procs?.runAura(procs, ctx) },
});

/** Hits every unit a delivery caught for an amount, as a hero's area spell does. */
const hitAll =
  (amount: number) =>
  (c: { readonly owner: Unit<CoopGame> }, hit: { readonly targets: readonly Unit<CoopGame>[] }): undefined => {
    const blow = late.blow ?? missing();

    blow.attacker = c.owner;
    blow.amount = amount;

    for (const target of hit.targets) {
      blow.target = target;
      coopCounter.seen += DAMAGE.hit(blow).amount > 0 ? 1 : 0;
    }

    return undefined;
  };

/** The heroes' kits: a chilling field and a nova on each hero, and the bolts and pools they cast. */
const KINDS: Readonly<Record<'field' | 'nova' | 'bolt' | 'pool', AnyAreaTriggerDef<CoopGame>>> = {
  field: {
    shape: circle(5),
    lifetime: 'owner',
    anchor: 'owner',
    auras: [{ aura: 'chill' }],
  },
  nova: {
    shape: circle(4),
    lifetime: 'owner',
    anchor: 'owner',
    every: [{ seconds: 0.5, onPulse: hitAll(6) }],
  },
  bolt: {
    shape: circle(0.4),
    lifetime: 1,
    ledgers: { hits: { policy: 'once', pierce: 3 } },
    contact: { radius: 0.4, ledger: 'hits' },

    move: (c, dt) => {
      c.position.x += Math.sin(c.heading) * 20 * dt;
      c.position.z += Math.cos(c.heading) * 20 * dt;
    },

    onContact: hitAll(10),
  },
  pool: { shape: circle(3), lifetime: 4, every: [{ seconds: 0.5, onPulse: hitAll(4) }] },
};

const AREA_KINDS = defineAreaTriggers<CoopGame, 'field' | 'nova' | 'bolt' | 'pool'>(KINDS);

const AREAS = createAreaTriggerSystem<CoopGame>({
  registry: AREA_KINDS,
  spells: SPELLS,
  auras: AURA_SYSTEM,
  procs: () => late.procs ?? missing(),
  world: WORLD,
  clock: CLOCK,
  host: { idOf: (unit) => unit.id },
});

late.procs = createProcSystem<CoopGame>({
  kinds: createProcRegistry<CoopGame>({
    ...CORE_PROCS,
    ...DAMAGE.procKinds,
    ...SPELLS.procKinds,
    ...UNITS.procKinds,
    ...AI.procKinds,
    ...AREAS.procKinds,
  }),
  auras: AURA_SYSTEM,
  host: { idOf: (unit) => unit.id },
});

/** The draw spawn points and headings take. */
const DRAW = stream(5, 61);

/** The auras every mob holds from its spawn. */
const HASTE = AURAS.id.haste;

/** The heroes at the centre, and the horde around them. */
const heroes: Unit<CoopGame>[] = [];
const mobs: Unit<CoopGame>[] = [];

/** Each wave's variant of the grunt: every mob of a wave shares its scaled bases. */
const WAVES = [{ maxHealth: 40 }, { maxHealth: 55, power: 12 }, { maxHealth: 70, power: 14 }].map((stats) =>
  UNITS.variant(TEMPLATES.id.grunt, stats),
);

/** A point reused for every placement. */
const AT: { x: number; z: number } = { x: 0, z: 0 };

/** Spawns a mob of the current wave on a ring 15–25 m out, into the world, hasted, chasing a hero. */
const spawnMob = (): Unit<CoopGame> => {
  const wave = WAVES[Math.floor(CLOCK.tick / 600) % WAVES.length] ?? missing();
  const mob = UNITS.spawn(TEMPLATES.id.grunt, { side: 1, variant: wave });
  const angle = DRAW() * 2 * Math.PI;
  const distance = 15 + 10 * DRAW();

  AT.x = Math.sin(angle) * distance;
  AT.z = Math.cos(angle) * distance;
  WORLD.add(mob, { id: mob.id, at: AT, radius: 0.4, side: 1 });
  AURA_SYSTEM.apply(mob, HASTE);
  CHASES[mob.id] = mob.id % HEROES;

  return mob;
};

/** Spawns the heroes with their fields and novas, and the horde, once. */
const setUp = (): void => {
  if (heroes.length > 0) {
    return;
  }

  for (let i = 0; i < HEROES; i++) {
    const hero = UNITS.spawn(TEMPLATES.id.hero, { side: 0 });

    AT.x = (i % 2) * 4 - 2;
    AT.z = Math.floor(i / 2) * 4 - 2;
    WORLD.add(hero, { id: hero.id, at: AT, radius: 0.5, side: 0 });
    heroes.push(hero);
    AREAS.spawn(AREA_KINDS.id.field, { owner: hero, at: AT });
    AREAS.spawn(AREA_KINDS.id.nova, { owner: hero, at: AT });
  }

  late.swing = [damage<CoopGame>(3, { to: 'target' })];
  late.blow = { target: heroes[0] ?? missing(), amount: 0 };

  for (let i = 0; i < MOBS; i++) {
    mobs.push(spawnMob());
  }
};

/** The heroes circle slowly around the centre, each on its own ring. */
const moveHeroes = (): void => {
  for (let i = 0; i < heroes.length; i++) {
    const hero = heroes[i] ?? missing();
    const angle = CLOCK.tick * DT * 0.3 + (i * Math.PI) / 2;

    AT.x = Math.sin(angle) * (2 + i);
    AT.z = Math.cos(angle) * (2 + i);
    WORLD.place(hero, AT);
  }
};

/** A mob walks toward its hero until its swing reaches, at its folded speed. */
const walk = (mob: Unit<CoopGame>): void => {
  const hero = heroes[CHASES[mob.id] ?? 0] ?? missing();
  const at = WORLD.positionOf(mob);
  const goal = WORLD.positionOf(hero);
  const dx = goal.x - at.x;
  const dz = goal.z - at.z;
  const gap = hypot(dx, dz);

  if (gap > REACH && UNITS.canMove(mob)) {
    const step = Math.min(gap - REACH, WALK * UNITS.statsOf(mob).total(STATS.id.speed)) / gap;

    AT.x = at.x + dx * step;
    AT.z = at.z + dz * step;
    WORLD.place(mob, AT);
  }

  GAP[mob.id] = gap;
};

/** The heroes' casts: a bolt from each every 0.25 s, a pool from each every 2 s, staggered. */
const cast = (): void => {
  const { tick } = CLOCK;

  for (let i = 0; i < heroes.length; i++) {
    const hero = heroes[i] ?? missing();
    const at = WORLD.positionOf(hero);

    if ((tick + i * 4) % 15 === 0) {
      AREAS.spawn(AREA_KINDS.id.bolt, { owner: hero, at, heading: DRAW() * 2 * Math.PI });
    }

    if ((tick + i * 30) % 120 === 0) {
      AT.x = at.x + (DRAW() - 0.5) * 8;
      AT.z = at.z + (DRAW() - 0.5) * 8;
      AREAS.spawn(AREA_KINDS.id.pool, { owner: hero, at: AT });
    }
  }
};

/** The dead fall and are replaced at the edge by the current wave. */
const replaceDead = (): void => {
  for (let i = 0; i < mobs.length; i++) {
    const mob = mobs[i] ?? missing();

    if (mob.lifecycle !== 'alive') {
      WORLD.remove(mob);
      UNITS.despawn(mob);
      mobs[i] = spawnMob();
      coopCounter.seen += 1;
    }
  }
};

/** One 60 Hz tick of the co-op game: world, heroes, every mob's auras, walk and swing, area triggers, deaths. */
const tick = (): void => {
  setUp();
  CLOCK.step();
  WORLD.tick();
  moveHeroes();

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

  cast();
  AREAS.step();
  SPELLS.stepDelayed();
  replaceDead();
};

/** What the co-op game did so far: the area triggers live and the mobs in reach of their hero now. */
export const coopStats = (): { readonly live: number; readonly inReach: number } => ({
  live: AREAS.pool.live,
  inReach: mobs.filter((mob) => (GAP[mob.id] ?? 0) <= REACH).length,
});

/** The co-op benchmark task, and how many operations each call of its function is. */
export const COOP_TASKS: readonly (readonly [string, () => void, number])[] = [
  ['co-op: 350 mobs on 4 heroes, 60 Hz, fields + AoE (tick)', tick, 1],
];
