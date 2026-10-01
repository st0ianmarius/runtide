import { bench, do_not_optimize, run } from 'mitata';

import {
  type AuraBearer,
  auraGates,
  auraStacks,
  createAuraSystem,
  defineAuras,
  defineAuraTags
} from '../src/auras/index.ts';
import { defineConditions } from '../src/conditions/index.ts';
import {
  createBitset,
  createClock,
  createRegistry,
  createTimingWheel,
  type Id,
  roll,
  rollKey,
  stream
} from '../src/core/index.ts';
import {
  add,
  amp,
  compileScaled,
  createModifierSystem,
  curveOf,
  customCurve,
  defineCurves,
  defineSources,
  defineStats,
  evaluateScaled,
  finishScaled,
  mul,
  plus,
  ranks,
  scaled,
  snapshotScaled
} from '../src/modifiers/index.ts';
import { ABILITY_TASKS, abilityCounter } from './abilities.ts';
import { AREA_TASKS, areaCounter, areaStats } from './area-triggers.ts';
import { LOG_TASKS, logCounter } from './combat-log.ts';
import { CUE_TASKS, CUE_TICK_BYTES, cueCounter } from './cues.ts';
import { DAMAGE_TASKS, damageCounter } from './damage.ts';
import { counter, PROC_TRIGGER_TASKS } from './procs-triggers.ts';
import { SPELL_TASKS, spellCounter, spellHordeStats } from './spells.ts';
import { UNIT_TASKS, unitCounter } from './units.ts';
import { WORLD_TASKS, worldCounter } from './world.ts';

/**
 * How the runner is asked: `node bench/run.ts [filter] [--json]`. The filter (a case-blind pattern) picks the rows to
 * run; `--json` prints only each row's median nanoseconds per operation, by name, for `bench/ab.ts` to compare (a
 * median, as the garbage collector's pauses swing a mean from run to run).
 */
const ARGS = process.argv.slice(2);
const IS_JSON = ARGS.includes('--json');
const PATTERN = ARGS.find((arg) => !arg.startsWith('--'));
const FILTER = PATTERN === undefined ? undefined : new RegExp(PATTERN, 'i');

/** How many schedules the timing wheel row makes per tick it collects. */
const PER_TICK = 1000;

/** A registry of 256 definitions with a typed column and one hook, as a spell table would be. */
const SPELLS = createRegistry(
  Object.fromEntries(
    Array.from({ length: 256 }, (_unused, index) => [
      `spell${index}`,
      { cooldown: index % 17, onHit: index % 2 === 0 ? (): number => index : undefined }
    ])
  ),
  {
    kind: 'spells',
    columns: { cooldown: { type: 'f64', of: (def) => def.cooldown } }
  }
);

/** The spells' `onHit` dispatch table and `has` bitset, as a system builds its own over a registry's definitions. */
const ON_HIT = SPELLS.defs.map((def) => def?.onHit);
const HAS_ON_HIT = createBitset(ON_HIT.flatMap((hook, id) => (hook === undefined ? [] : [id])));

const IDS: readonly Id<'spells'>[] = SPELLS.ids;
const TAGS = createBitset(Array.from({ length: 64 }, (_unused, index) => index * 3));
const IMMUNE = createBitset([7, 190]);
const WHEEL = createTimingWheel<number>({ horizon: 256 });
const FIRED: (number | undefined)[] = [];
const SCRATCH_KEY = [0, 0, 0, 0];
const MAIN = stream(12_345);
let tick = 0;
let sink = 0;

/** A hero-like bearer: six sources, a dozen modifiers on damage and speed, a condition and two gated aura lists. */
interface Bearer {
  hp: number;
  readonly stacks: number[];
}

const STATS = defineStats(
  {
    attackDamage: { base: 60, kind: 'flat' },
    abilityPower: { base: 0, kind: 'flat' },
    abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
    maxHealth: { base: 600, kind: 'flat' },
    damage: { base: 1, kind: 'multiplier' },
    moveSpeed: { base: 0, kind: 'flat', min: 0 }
  },
  { curves: defineCurves({ haste: customCurve((x) => (x >= 0 ? 100 / (100 + x) : 1 - x / 100)) }) }
);

const SOURCES = defineSources(['race', 'gear', 'banner', 'talents', 'auras', 'stance']);

const CONDITIONS = defineConditions({
  healthBelow: (bearer: Bearer, share) => bearer.hp < 100 * share
});

const MODIFIERS = createModifierSystem({
  stats: STATS,
  sources: SOURCES,
  conditions: CONDITIONS,
  stacks: (bearer: Bearer, gate) => bearer.stacks[gate] ?? 0
});

const SHEET = MODIFIERS.createSheet();
const BEARER: Bearer = { hp: 80, stacks: [1, 0, 3] };
const READ = { host: BEARER };

MODIFIERS.setSource(SHEET, SOURCES.id.race, [MODIFIERS.compile([plus('moveSpeed', 6.2), plus('attackDamage', 40)])]);
MODIFIERS.setSource(SHEET, SOURCES.id.gear, [MODIFIERS.compile([mul('damage', 1.3), mul('moveSpeed', 0.9)])]);
MODIFIERS.setSource(SHEET, SOURCES.id.talents, [MODIFIERS.compile([plus('damage', 0.25), mul('moveSpeed', 1.1)])]);
MODIFIERS.share(SOURCES.id.auras, [
  MODIFIERS.compile([mul('damage', 1.2), mul('moveSpeed', 1.3)], { gate: 0 }),
  MODIFIERS.compile([mul('damage', 1.05)], { gate: 2 })
]);
MODIFIERS.setSource(SHEET, SOURCES.id.stance, [
  MODIFIERS.compile([mul('damage', 1.5, { when: { is: 'healthBelow', arg: 0.4 } }), mul('moveSpeed', 1.2)])
]);

const CASTER = MODIFIERS.view(SHEET, READ);
const TARGET = { total: (): number => 2000, base: (): number => 600 };

const DAMAGE = compileScaled(
  STATS,
  scaled(
    ranks(60, 95, 130),
    add('attackDamage', 1.2),
    add('abilityPower', 0.5),
    add('maxHealth', 0.08, { from: 'target' }),
    amp('damage', 1.1)
  ),
  { ranks: 3 }
);

const COOLDOWN = compileScaled(STATS, scaled(12, curveOf('haste', 0.5)));
const EVALUATION = { caster: CASTER, target: TARGET, rank: 2 };
const SNAPSHOT = snapshotScaled(DAMAGE, { caster: CASTER, rank: 2 });

/** An aura game: three stats, a tag table and six auras, two of them folding modifiers. */
const AURA_STATS = defineStats({
  damage: { base: 1, kind: 'multiplier' },
  armor: { base: 0, kind: 'flat' },
  moveSpeed: { base: 6, kind: 'flat' }
});

const AURA_SOURCES = defineSources(['base', 'auras']);

const AURA_MODIFIERS = createModifierSystem({
  stats: AURA_STATS,
  sources: AURA_SOURCES,
  stacks: auraStacks,
  held: auraGates
});

const AURAS = defineAuras({
  might: {
    duration: 8,
    stacking: 'stack',
    maxStacks: 5,
    modifiers: [plus('armor', 10), mul('damage', 1.05)]
  },
  fury: { duration: 6, modifiers: [mul('damage', 1.2)] },
  haste: { duration: 4, stacking: 'highest', modifiers: [mul('moveSpeed', 1.3)] },
  dot: { duration: 'infinite', periodic: { every: 0.5, onBeat: () => BEAT } },
  ward: { duration: 'infinite', value: 50, tags: ['guarded'] },
  slow: { duration: 'infinite', modifiers: [mul('moveSpeed', 0.7)] }
});

const BEAT: readonly string[] = ['burn'];

const AURA_SYSTEM = createAuraSystem({
  registry: AURAS,
  tags: defineAuraTags(['guarded']),
  clocks: { world: createClock({ dt: 1 / 60 }) },
  modifiers: AURA_MODIFIERS,
  fold: 'auras',

  host: {
    run: (procs) => {
      sink += procs.length;
    }
  }
});

const AURA_BEARER: AuraBearer = { auras: AURA_SYSTEM.createState() };
const AURA_SHEET = AURA_MODIFIERS.createSheet();
const AURA_READ = { host: AURA_BEARER };

/** A game-sized aura catalogue: 120 auras folding moveSpeed and armor, on a bearer holding two of them. */
const CATALOGUE_MODIFIERS = createModifierSystem({
  stats: AURA_STATS,
  sources: AURA_SOURCES,
  stacks: auraStacks,
  held: auraGates
});

const CATALOGUE = defineAuras(
  Object.fromEntries(
    Array.from({ length: 120 }, (_unused, i) => [
      `a${i}`,
      {
        duration: 'infinite' as const,
        modifiers: [mul('moveSpeed', 1 + i / 1000), plus('armor', 1)]
      }
    ])
  )
);

const CATALOGUE_SYSTEM = createAuraSystem({
  registry: CATALOGUE,
  tags: defineAuraTags([]),
  clocks: { world: createClock({ dt: 1 / 60 }) },
  modifiers: CATALOGUE_MODIFIERS,
  fold: 'auras',
  host: { run: () => undefined }
});

const CATALOGUE_BEARER: AuraBearer = { auras: CATALOGUE_SYSTEM.createState() };

for (const name of ['a7', 'a90']) {
  const id = CATALOGUE.id[name];

  if (id !== undefined) {
    CATALOGUE_SYSTEM.apply(CATALOGUE_BEARER, id);
  }
}

const CATALOGUE_SHEET = CATALOGUE_MODIFIERS.createSheet();
const CATALOGUE_READ = { host: CATALOGUE_BEARER };

/** The horde: 2,000 bearers with three auras each, one of them beating twice a second. */
const HORDE: AuraBearer[] = Array.from({ length: 2000 }, () => {
  const bearer: AuraBearer = { auras: AURA_SYSTEM.createState() };

  AURA_SYSTEM.apply(bearer, AURAS.id.dot);
  AURA_SYSTEM.apply(bearer, AURAS.id.ward);
  AURA_SYSTEM.apply(bearer, AURAS.id.slow);

  return bearer;
});

/** 2,000 bearers holding two auras with nothing due on a tick: an infinite passive and a long buff. */
const PASSIVES: AuraBearer[] = Array.from({ length: 2000 }, () => {
  const bearer: AuraBearer = { auras: AURA_SYSTEM.createState() };

  AURA_SYSTEM.apply(bearer, AURAS.id.slow);
  AURA_SYSTEM.apply(bearer, { aura: AURAS.id.might, duration: 600 });

  return bearer;
});

let n = 0;

/** Every row, in order: the core's, then each system's. */
const ROWS: readonly (readonly [string, () => void])[] = [
  [
    'registry get(id) + column read',
    () => {
      const id = IDS[(n += 1) & 255];

      if (id !== undefined) {
        sink += SPELLS.get(id).cooldown + (SPELLS.columns.cooldown[id] ?? 0);
      }
    }
  ],
  [
    'registry has-bit + hook table dispatch',
    () => {
      const id = (n += 1) & 255;

      if (HAS_ON_HIT.has(id)) {
        sink += ON_HIT[id]?.() ?? 0;
      }
    }
  ],
  [
    'bitset has',
    () => {
      sink += TAGS.has((n += 1) & 255) ? 1 : 0;
    }
  ],
  [
    'bitset intersects (immunity check)',
    () => {
      sink += TAGS.intersects(IMMUNE) ? 1 : 0;
    }
  ],
  [
    'timing wheel schedule + collect (15% overflow)',
    () => {
      n += 1;
      WHEEL.schedule(tick + 1 + (n % 300), n);

      if (n % PER_TICK === 0) {
        tick += 1;
        sink += WHEEL.collect(tick, FIRED);
      }
    }
  ],
  [
    'keyed roll, 5-part key (spread)',
    () => {
      sink += roll(12_345, 7, tick, (n += 1), 3, 12, 0);
    }
  ],
  [
    'keyed roll, 4-part scratch key',
    () => {
      SCRATCH_KEY[0] = tick;
      SCRATCH_KEY[1] = n += 1;
      sink += rollKey(12_345, 7, SCRATCH_KEY);
    }
  ],
  [
    'sequential stream draw',
    () => {
      sink += MAIN();
    }
  ],
  [
    'modifier fold, two stats (6 sources, gates)',
    () => {
      sink += MODIFIERS.resolve(SHEET, STATS.id.damage, READ) + MODIFIERS.resolve(SHEET, STATS.id.moveSpeed, READ);
    }
  ],
  [
    'scaled value evaluation (live folded stats)',
    () => {
      sink += evaluateScaled(DAMAGE, EVALUATION);
    }
  ],
  [
    'scaled value finish from a snapshot',
    () => {
      sink += finishScaled(SNAPSHOT, TARGET);
    }
  ],
  [
    'scaled cooldown through the haste curve',
    () => {
      sink += evaluateScaled(COOLDOWN, EVALUATION);
    }
  ],
  [
    'aura apply x3 + fold two stats',
    () => {
      AURA_SYSTEM.apply(AURA_BEARER, AURAS.id.might);
      AURA_SYSTEM.apply(AURA_BEARER, AURAS.id.fury);
      AURA_SYSTEM.apply(AURA_BEARER, AURAS.id.haste);
      sink +=
        AURA_MODIFIERS.resolve(AURA_SHEET, AURA_STATS.id.damage, AURA_READ) +
        AURA_MODIFIERS.resolve(AURA_SHEET, AURA_STATS.id.moveSpeed, AURA_READ);
    }
  ],
  [
    'fold a stat, 120 aura lists in the game, 2 held',
    () => {
      sink += CATALOGUE_MODIFIERS.resolve(CATALOGUE_SHEET, AURA_STATS.id.moveSpeed, CATALOGUE_READ);
    }
  ],
  [
    'aura tick, 2,000 bearers x 3 auras (per tick)',
    () => {
      for (const bearer of HORDE) {
        AURA_SYSTEM.tick(bearer, 'world');
      }
    }
  ],
  [
    'aura tick, 2,000 bearers x 2 auras, nothing due (per tick)',
    () => {
      for (const bearer of PASSIVES) {
        AURA_SYSTEM.tick(bearer, 'world');
      }
    }
  ],
  ...PROC_TRIGGER_TASKS,
  ...DAMAGE_TASKS,
  ...CUE_TASKS,
  ...SPELL_TASKS,
  ...WORLD_TASKS,
  ...AREA_TASKS,
  ...ABILITY_TASKS,
  ...LOG_TASKS,
  ...UNIT_TASKS
];

/** Each row's median nanoseconds per operation, by name, as the phases ran. */
const medians = new Map<string, number>();

/** Whether any row of a list passes the filter: a phase none of whose rows run is not loaded at all. */
const isWanted = (names: readonly string[]): boolean => FILTER === undefined || names.some((name) => FILTER.test(name));

/**
 * Runs one phase's rows through mitata: one operation per iteration, the sink kept live with `do_not_optimize`, its
 * table printed unless `--json` asks for the means alone.
 */
const runPhase = async (rows: readonly (readonly [string, () => void])[]): Promise<void> => {
  for (const [name, task] of rows) {
    bench(name, () => {
      task();
      do_not_optimize(sink);
    });
  }

  const { benchmarks } = await run({
    ...(FILTER === undefined ? {} : { filter: FILTER }),
    format: IS_JSON ? 'quiet' : 'mitata'
  });

  for (const trial of benchmarks) {
    for (const each of trial.runs) {
      if (each.stats !== undefined) {
        medians.set(each.name, each.stats.p50);
      }
    }
  }
};

await runPhase(ROWS);

// The whole-game horde runs after the rows above and is loaded only now: a whole game's systems made at load would
// change the type feedback every row above runs under, so its module waits until they are done. A late phase whose
// rows the filter leaves out is never loaded.
const horde = isWanted(['horde: 2,000 mobs + 4 heroes, the whole unit game (tick)'])
  ? await import('./horde.ts')
  : undefined;

if (horde !== undefined) {
  await runPhase(horde.HORDE_TASKS);
}

// The co-op game runs after it, on a fresh module for the same reason.
const coop = isWanted(['co-op: 350 mobs on 4 heroes, 60 Hz, fields + AoE (tick)'])
  ? await import('./coop.ts')
  : undefined;

if (coop !== undefined) {
  await runPhase(coop.COOP_TASKS);
}

sink +=
  counter.granted +
  damageCounter.taken +
  cueCounter.bytes +
  cueCounter.numbers +
  cueCounter.decoded +
  spellCounter.granted +
  worldCounter.found +
  areaCounter.granted +
  abilityCounter.granted +
  logCounter.seen +
  unitCounter.seen +
  (horde?.hordeCounter.seen ?? 0) +
  (coop?.coopCounter.seen ?? 0);

if (IS_JSON) {
  process.stdout.write(`${JSON.stringify(Object.fromEntries(medians))}\n`);
} else {
  const flight = spellHordeStats();
  const areas = areaStats();
  const whole = horde?.hordeStats();
  const party = coop?.coopStats();

  // What the rows did, so a change in behaviour shows beside a change in time.
  const facts = [
    `sink ${sink > 0 ? 'ok' : 'empty'}`,
    `one cue tick is ${CUE_TICK_BYTES} bytes`,
    `${flight.inFlight} of 2,000 casters have a spell in flight, ${flight.created} cast records made`,
    `${areas.live} area triggers live, ${areas.created} records made`,
    ...(whole === undefined
      ? []
      : [`${whole.inReach} of the whole game's mobs in reach, ${whole.swings} swings landed`]),
    ...(party === undefined
      ? []
      : [`${party.inReach} of the co-op game's mobs in reach, ${party.live} area triggers live`])
  ];

  process.stdout.write(`\n(${facts.join('; ')})\n`);
}
