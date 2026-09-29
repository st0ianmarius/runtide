import { type AuraState, createAuraSystem, defineAuras, defineAuraTags } from '../src/auras/index.ts';
import { createClock } from '../src/core/index.ts';
import { add, defineStats, scaled, type StatView } from '../src/modifiers/index.ts';
import {
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  grant,
  type Proc,
  type ProcOrigin,
} from '../src/procs/index.ts';
import {
  after,
  type AfterProc,
  type CasterState,
  createSpellSystem,
  defineSpell,
  defineSpells,
  type SpellCaster,
  type SpellProcs,
  type SpellTypes,
} from '../src/spells/index.ts';

/** A bench caster: an entity id, its auras and its casts. */
interface Unit extends SpellCaster {
  /** Its entity id. */
  readonly id: number;

  /** Its auras. */
  readonly auras: AuraState;

  /** Its casts. */
  readonly casts: CasterState;
}

/** The bench game's types. */
interface BenchGame extends SpellTypes {
  /** A bench caster. */
  readonly bearer: Unit;

  /** Procs. */
  readonly proc: Proc<BenchGame>;

  /** No triggers. */
  readonly trigger: never;

  /** One stat. */
  readonly stat: 'power';

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

  /** One resource, which every beat grants. */
  readonly resource: 'focus';

  /** No named streams. */
  readonly stream: never;

  /** No game services. */
  readonly host: object;

  /** The spell system's kinds. */
  readonly gameProc: SpellProcs<BenchGame>;

  /** Open spell names. */
  readonly spellName: string;

  /** No spell tags. */
  readonly spellTag: never;

  /** No input. */
  readonly input: undefined;

  /** One interrupt. */
  readonly interrupt: 'stun';

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** No game fields on a cast. */
  readonly castExt: undefined;

  /** No game data on a spell. */
  readonly spellData: undefined;
}

const STATS = defineStats({ power: { base: 10, kind: 'flat' } });

/** The view every bench caster reads. */
const VIEW: StatView = {
  total: (stat) => STATS.columns.base[stat] ?? 0,
  base: (stat) => STATS.columns.base[stat] ?? 0,
};

/** How many resources the bench granted, so no call is optimised away. */
export const spellCounter = { granted: 0 };

/** One grant, prepared once: what every beat and release runs. */
const GRANT: readonly Proc<BenchGame>[] = Object.freeze([grant<BenchGame>('focus', 1)]);

const spell = defineSpell<BenchGame>();

/** Nineteen more `auto` spells, a game's arsenal (every 60 s, releasing one grant), which no horde caster arms. */
const ARSENAL = Object.fromEntries(
  Array.from({ length: 19 }, (_unused, i) => [
    `weapon${i}`,
    spell({ activation: { kind: 'auto', interval: 60 }, release: () => GRANT }),
  ]),
);

/**
 * The bench spells: `strike`, an auto spell every 3 s that winds up 0.5 s, channels 2 s beating every 0.5 s and
 * recovers 0.25 s, so a caster almost always has it in flight; `bolt`, an instant cast with a stats table; and the
 * arsenal, so 20 `auto` spells are defined and each caster arms one.
 */
const SPELLS = defineSpells<BenchGame, string>(
  {
    ...ARSENAL,
    strike: spell({
      activation: { kind: 'auto', interval: 3 },
      stats: { power: scaled(10, add('power', 1)) },
      timeline: {
        windup: { seconds: 0.5 },
        channel: { seconds: 2, every: 0.5, tick: () => GRANT },
        recover: { seconds: 0.25 },
        interrupts: { stun: 'pause' },
      },
      release: () => GRANT,
    }),
    bolt: spell({
      activation: { kind: 'trigger' },
      stats: { power: scaled(10, add('power', 1)), radius: 3 },
      release: () => GRANT,
    }),
  },
  { stats: STATS },
);

const CLOCK = createClock({ dt: 1 / 30 });

const AURAS = createAuraSystem<BenchGame>({
  registry: defineAuras<BenchGame, never>({}),
  tags: defineAuraTags(['ward']),
  clocks: { world: CLOCK },
});

const HOST = {
  idOf: (unit: Unit) => unit.id,
  statsOf: () => VIEW,

  grant: (_unit: Unit, _resource: number, amount: number) => {
    spellCounter.granted += amount;
  },
};

const late: { procs?: ReturnType<typeof createProcSystem<BenchGame>> } = {};

const SYSTEM = createSpellSystem<BenchGame>({
  registry: SPELLS,
  auras: AURAS,
  procs: () => late.procs ?? missing(),
  clock: CLOCK,
  host: HOST,
});

const PROCS = createProcSystem<BenchGame>({
  kinds: createProcRegistry<BenchGame>({ ...CORE_PROCS, ...SYSTEM.procKinds }),
  auras: AURAS,
  host: HOST,
  resources: ['focus'],
});

late.procs = PROCS;

/** Throws: the proc system is wired right after the spell system. */
function missing(): never {
  throw new Error('The bench proc system is not wired.');
}

/** Makes a caster. */
const casterOf = (id: number): Unit => ({ id, auras: AURAS.createState(), casts: SYSTEM.createCasterState() });

/** The id of a bench spell. */
const spellId = (name: string) => SPELLS.id[name] ?? missing();

/** A horde caster: `strike` armed. */
const striker = (id: number): Unit => {
  const unit = casterOf(id);

  SYSTEM.arm(unit, spellId('strike'));

  return unit;
};

/** 2,000 casters, each with one arsenal clock armed and far from running out: the idle auto step. */
const IDLERS: readonly Unit[] = Array.from({ length: 2000 }, (_unused, index) => {
  const unit = casterOf(20_000 + index);

  SYSTEM.arm(unit, spellId(`weapon${index % 19}`), 1e9);

  return unit;
});

/** The horde: 2,000 casters, their auto clocks spread so their casts do not all start on the same tick. */
const HORDE: readonly Unit[] = Array.from({ length: 2000 }, (_unused, index) => striker(index + 1));

/** One tick of the horde: the clock steps, then each caster's auto clock and casts. */
const hordeTick = (): void => {
  CLOCK.step();

  for (const unit of HORDE) {
    SYSTEM.stepAuto(unit);
    SYSTEM.step(unit);
  }
};

// Stagger the horde (each caster runs a different number of its own steps first, so their casts are at different
// points of their course), then run it to a steady state before timing it.
for (const [index, unit] of HORDE.entries()) {
  for (let i = 0; i < index % 90; i++) {
    SYSTEM.stepAuto(unit);
    SYSTEM.step(unit);
  }
}

for (let i = 0; i < 200; i++) {
  hordeTick();
}

/** The caster the other tasks use. */
const SOLO = casterOf(9999);

/** The origin a delayed list is scheduled for. */
const ORIGIN: ProcOrigin<BenchGame> = { self: SOLO };

/** One delayed grant, due on the next tick, prepared once. */
const DELAYED: readonly AfterProc<BenchGame>[] = Object.freeze([after<BenchGame>(0, GRANT)]);

/** A thousand delayed grants, all due on the next tick. */
const THOUSAND: readonly AfterProc<BenchGame>[] = Object.freeze(
  Array.from({ length: 1000 }, () => after<BenchGame>(0, GRANT)),
);

/** Schedules one delayed list and lands it on the next tick. */
const delayOne = (): void => {
  PROCS.run(DELAYED, ORIGIN);
  CLOCK.step();
  SYSTEM.stepDelayed();
};

/** Schedules a thousand delayed lists and lands them all on the next tick. */
const delayThousand = (): void => {
  PROCS.run(THOUSAND, ORIGIN);
  CLOCK.step();
  SYSTEM.stepDelayed();
};

/** One instant cast: gates, a stats table snapshot, the release, the end. */
const castBolt = (): void => {
  SYSTEM.cast(SOLO, spellId('bolt'));
};

/** How many casts the horde has in flight, and how many records it made: what the baseline reports beside the times. */
export const spellHordeStats = (): { readonly inFlight: number; readonly created: number } => ({
  inFlight: HORDE.reduce((count, unit) => count + unit.casts.count, 0),
  created: SYSTEM.pool.created,
});

/** One tick of the idle casters' auto step: one armed clock each, 20 defined. */
const idleTick = (): void => {
  for (const unit of IDLERS) {
    SYSTEM.stepAuto(unit);
  }
};

/** The F7 benchmark tasks, and how many operations each call of its function is. */
export const SPELL_TASKS: readonly (readonly [string, () => void, number])[] = [
  ['spells: horde tick, 2,000 casters in flight (tick)', hordeTick, 1000],
  ['spells: auto step, 2,000 casters, 1 of 20 auto spells armed (tick)', idleTick, 1000],
  ['spells: instant cast, table stats + release', castBolt, 1],
  ['spells: after(0), scheduled + landed (per list)', delayOne, 1],
  ['spells: 1,000 after(0) landing on one tick (tick)', delayThousand, 1000],
];
