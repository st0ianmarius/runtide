import {
  type AnyAreaTriggerDef,
  type AreaTriggerProcs,
  type AreaTriggerTypes,
  createAreaTriggerSystem,
  defineAreaTriggers,
} from '../src/area-triggers/index.ts';
import { type AuraState, createAuraSystem, defineAuras, defineAuraTags } from '../src/auras/index.ts';
import { createClock, stream } from '../src/core/index.ts';
import { circle, vec2 } from '../src/math/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem, grant, type Proc } from '../src/procs/index.ts';
import {
  type CasterState,
  createSpellSystem,
  defineSpells,
  type SpellCaster,
  type SpellProcs,
} from '../src/spells/index.ts';
import { createMemoryWorld } from '../src/world/index.ts';

/** A bench unit: an entity id, its auras and its casts. */
interface Unit extends SpellCaster {
  /** Its entity id. */
  readonly id: number;

  /** Its auras. */
  readonly auras: AuraState;

  /** Its casts. */
  readonly casts: CasterState;
}

/** The bench game's types. */
interface BenchGame extends AreaTriggerTypes {
  /** A bench unit. */
  readonly bearer: Unit;

  /** Procs. */
  readonly proc: Proc<BenchGame>;

  /** No triggers. */
  readonly trigger: never;

  /** No stats. */
  readonly stat: never;

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** One tag. */
  readonly tag: 'ward';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
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

  /** One resource, which every hit grants. */
  readonly resource: 'focus';

  /** No named streams. */
  readonly stream: never;

  /** No game services. */
  readonly host: object;

  /** The spell and area trigger systems' kinds. */
  readonly gameProc: SpellProcs<BenchGame> | AreaTriggerProcs<BenchGame>;

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

  /** No game data on a spell. */
  readonly spellData: undefined;

  /** Open area trigger names. */
  readonly areaTriggerName: string;

  /** No area trigger tags. */
  readonly areaTag: never;

  /** A missile's orbit phase. */
  readonly areaInput: number;

  /** No game fields on an area trigger. */
  readonly areaExt: undefined;
}

/** How many resources the bench granted, so no call is optimised away. */
export const areaCounter = { granted: 0 };

/** One grant, prepared once: what every hit runs. */
const GRANT: readonly Proc<BenchGame>[] = Object.freeze([grant<BenchGame>('focus', 1)]);

/** A pool: 3 m across, beating every 0.5 s on its foes inside. */
const pool: AnyAreaTriggerDef<BenchGame> = {
  shape: circle(3),
  lifetime: 'spent',
  every: [{ seconds: 0.5, onPulse: (_c, hit) => (hit.targets.length > 0 ? GRANT : undefined) }],
};

/** A missile orbiting its spawn point at 12 m/s, sweeping its foes, each again after a second. */
const missile: AnyAreaTriggerDef<BenchGame> = {
  shape: circle(0.5),
  lifetime: 'spent',
  ledgers: { hits: { policy: 'rehit', cooldown: 1 } },
  contact: { radius: 0.5, ledger: 'hits' },

  move: (c, dt) => {
    const phase = (c.input ?? 0) + c.age * 1.2;

    c.position.x += Math.cos(phase) * 12 * dt;
    c.position.z -= Math.sin(phase) * 12 * dt;
  },

  onContact: () => GRANT,
};

const KINDS = defineAreaTriggers<BenchGame, 'pool' | 'missile'>({ pool, missile });
const CLOCK = createClock({ dt: 1 / 30 });
const WORLD = createMemoryWorld<Unit>({ bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 }, dt: 1 / 30 });

const AURAS = createAuraSystem<BenchGame>({
  registry: defineAuras<BenchGame, never>({}),
  tags: defineAuraTags(['ward']),
  clocks: { world: CLOCK },
});

const HOST = {
  idOf: (unit: Unit) => unit.id,

  grant: (_unit: Unit, _resource: number, amount: number) => {
    areaCounter.granted += amount;
  },
};

const late: { procs?: ReturnType<typeof createProcSystem<BenchGame>> } = {};

/** Throws: the proc system is wired right after the systems that name it. */
const missing = (): never => {
  throw new Error('The bench proc system is not wired.');
};

const SPELLS = createSpellSystem<BenchGame>({
  registry: defineSpells<BenchGame, never>({}),
  auras: AURAS,
  procs: () => late.procs ?? missing(),
  clock: CLOCK,
  host: HOST,
});

const AREAS = createAreaTriggerSystem<BenchGame>({
  registry: KINDS,
  spells: SPELLS,
  auras: AURAS,
  procs: () => late.procs ?? missing(),
  world: WORLD,
  clock: CLOCK,
  host: HOST,
});

late.procs = createProcSystem<BenchGame>({
  kinds: createProcRegistry<BenchGame>({ ...CORE_PROCS, ...SPELLS.procKinds, ...AREAS.procKinds }),
  auras: AURAS,
  host: HOST,
  resources: ['focus'],
});

const random = stream(777);

/** A unit in the world at a place, on a side. */
const unitAt = (id: number, [x, z, side]: readonly [number, number, number]): Unit => {
  const unit: Unit = { id, auras: AURAS.createState(), casts: SPELLS.createCasterState() };

  WORLD.add(unit, { id, at: vec2(x, z), radius: 0.5, side });

  return unit;
};

/** Ten owners, and 2,000 foes spread evenly at random. */
const OWNERS: readonly Unit[] = Array.from({ length: 10 }, (_unused, i) => unitAt(i + 1, [i * 5 - 25, 0, 0]));

for (let i = 0; i < 2000; i++) {
  unitAt(100 + i, [(random() - 0.5) * 190, (random() - 0.5) * 190, 1]);
}

// 150 pools and 50 missiles, spread over the world.
for (let i = 0; i < 200; i++) {
  const owner = OWNERS[i % OWNERS.length] ?? missing();
  const at = vec2((random() - 0.5) * 160, (random() - 0.5) * 160);

  AREAS.spawn(i < 150 ? KINDS.id.pool : KINDS.id.missile, { owner, at, input: random() * 6 });
}

/** One tick: the clock and the world step, then every area trigger. */
const areaTick = (): void => {
  CLOCK.step();
  WORLD.tick();
  AREAS.step();
};

for (let i = 0; i < 100; i++) {
  areaTick();
}

/** How many area triggers are live and how many records were made: what the baseline reports beside the times. */
export const areaStats = (): { readonly live: number; readonly created: number } => ({
  live: AREAS.pool.live,
  created: AREAS.pool.created,
});

/** The F8 area trigger benchmark tasks, and how many operations each call of its function is. */
export const AREA_TASKS: readonly (readonly [string, () => void, number])[] = [
  ['areas: 150 pools + 50 missiles over 2,000 units (tick)', areaTick, 1000],
];
