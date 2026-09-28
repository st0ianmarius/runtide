import { Bench } from 'tinybench';

import { type AuraBearer, auraStacks, createAuraSystem, defineAuras, defineAuraTags } from '../src/auras/index.ts';
import {
  createBitset,
  createClock,
  createRegistry,
  createTimingWheel,
  type Id,
  roll,
  rollKey,
  stream,
} from '../src/core/index.ts';
import {
  add,
  amp,
  compileScaled,
  createModifierSystem,
  defineConditions,
  defineSources,
  defineStats,
  evaluateScaled,
  finishScaled,
  haste,
  mul,
  plus,
  ranks,
  scaled,
  snapshotScaled,
} from '../src/modifiers/index.ts';

/** Operations per task call: single operations are far below the timer's resolution, so each call runs a batch. */
const BATCH = 1000;

/** A registry of 256 definitions with a typed column and one hook, as a spell table would be. */
const SPELLS = createRegistry(
  Object.fromEntries(
    Array.from({ length: 256 }, (_unused, index) => [
      `spell${index}`,
      { cooldown: index % 17, onHit: index % 2 === 0 ? (): number => index : undefined },
    ]),
  ),
  {
    kind: 'spells',
    columns: { cooldown: { type: 'f64', of: (def) => def.cooldown } },
    hooks: ['onHit'],
  },
);

const IDS: readonly Id<'spells'>[] = SPELLS.ids;
const TAGS = createBitset(Array.from({ length: 64 }, (_unused, index) => index * 3));
const IMMUNE = createBitset([7, 190]);
const WHEEL = createTimingWheel<number>({ horizon: 256 });
const FIRED: number[] = [];
const SCRATCH_KEY = [0, 0, 0, 0];
const MAIN = stream(12_345);
let tick = 0;
let sink = 0;

/** A hero-like bearer: six sources, a dozen modifiers on damage and speed, a condition and two gated aura lists. */
interface Bearer {
  hp: number;
  readonly stacks: number[];
}

const STATS = defineStats({
  attackDamage: { base: 60, kind: 'flat' },
  abilityPower: { base: 0, kind: 'flat' },
  abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
  maxHealth: { base: 600, kind: 'flat' },
  damage: { base: 1, kind: 'multiplier' },
  moveSpeed: { base: 0, kind: 'flat', min: 0 },
});

const SOURCES = defineSources(['classBase', 'pacts', 'totem', 'passives', 'effects', 'classStates']);
const CONDITIONS = defineConditions({ healthBelow: (bearer: Bearer, share) => bearer.hp < 100 * share });

const MODIFIERS = createModifierSystem({
  stats: STATS,
  sources: SOURCES,
  conditions: CONDITIONS,
  stacks: (bearer: Bearer, gate) => bearer.stacks[gate] ?? 0,
});

const SHEET = MODIFIERS.createSheet();
const BEARER: Bearer = { hp: 80, stacks: [1, 0, 3] };
const READ = { host: BEARER };

MODIFIERS.setSource(SHEET, SOURCES.id.classBase, [
  MODIFIERS.compile([plus('moveSpeed', 6.2), plus('attackDamage', 40)]),
]);
MODIFIERS.setSource(SHEET, SOURCES.id.pacts, [MODIFIERS.compile([mul('damage', 1.3), mul('moveSpeed', 0.9)])]);
MODIFIERS.setSource(SHEET, SOURCES.id.passives, [MODIFIERS.compile([plus('damage', 0.25), mul('moveSpeed', 1.1)])]);
MODIFIERS.share(SOURCES.id.effects, [
  MODIFIERS.compile([mul('damage', 1.2), mul('moveSpeed', 1.3)], { gate: 0 }),
  MODIFIERS.compile([mul('damage', 1.05)], { gate: 2 }),
]);
MODIFIERS.setSource(SHEET, SOURCES.id.classStates, [
  MODIFIERS.compile([mul('damage', 1.5, { when: { is: 'healthBelow', arg: 0.4 } }), mul('moveSpeed', 1.2)]),
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
    amp('damage', 1.1),
  ),
  { ranks: 3 },
);

const COOLDOWN = compileScaled(STATS, scaled(12, haste(0.5)));
const EVALUATION = { caster: CASTER, target: TARGET, rank: 2 };
const SNAPSHOT = snapshotScaled(DAMAGE, { caster: CASTER, rank: 2 });

/** An aura game: three stats, a tag table and six auras, two of them folding modifiers. */
const AURA_STATS = defineStats({
  damage: { base: 1, kind: 'multiplier' },
  armor: { base: 0, kind: 'flat' },
  moveSpeed: { base: 6, kind: 'flat' },
});

const AURA_SOURCES = defineSources(['base', 'auras']);
const AURA_MODIFIERS = createModifierSystem({ stats: AURA_STATS, sources: AURA_SOURCES, stacks: auraStacks });

const AURAS = defineAuras({
  might: { duration: 8, stacking: 'stack', maxStacks: 5, modifiers: [plus('armor', 10), mul('damage', 1.05)] },
  fury: { duration: 6, modifiers: [mul('damage', 1.2)] },
  haste: { duration: 4, stacking: 'highest', modifiers: [mul('moveSpeed', 1.3)] },
  dot: { duration: 'infinite', periodic: { every: 0.5, onBeat: () => BEAT } },
  ward: { duration: 'infinite', value: 50, tags: ['guarded'] },
  slow: { duration: 'infinite', modifiers: [mul('moveSpeed', 0.7)] },
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
    },
  },
});

const AURA_BEARER: AuraBearer = { auras: AURA_SYSTEM.createState() };
const AURA_SHEET = AURA_MODIFIERS.createSheet();
const AURA_READ = { host: AURA_BEARER };

/** The horde: 2,000 bearers with three auras each, one of them beating twice a second. */
const HORDE: AuraBearer[] = Array.from({ length: 2000 }, () => {
  const bearer: AuraBearer = { auras: AURA_SYSTEM.createState() };

  AURA_SYSTEM.apply(bearer, AURAS.id.dot);
  AURA_SYSTEM.apply(bearer, AURAS.id.ward);
  AURA_SYSTEM.apply(bearer, AURAS.id.slow);

  return bearer;
});

/** Operations per call of each task, where it is not `BATCH`. */
const BATCHES = new Map([['aura tick, 2,000 bearers x 3 auras (per tick)', 1]]);

const bench = new Bench({ time: 400, warmup: true });

bench
  .add('registry get(id) + column read', () => {
    for (let i = 0; i < BATCH; i++) {
      const id = IDS[i & 255];

      if (id !== undefined) {
        sink += SPELLS.get(id).cooldown + (SPELLS.columns.cooldown[id] ?? 0);
      }
    }
  })
  .add('registry has-bit + hook table dispatch', () => {
    for (let i = 0; i < BATCH; i++) {
      const id = i & 255;

      if (SPELLS.has.onHit.has(id)) {
        sink += SPELLS.hooks.onHit[id]?.() ?? 0;
      }
    }
  })
  .add('bitset has', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += TAGS.has(i & 255) ? 1 : 0;
    }
  })
  .add('bitset intersects (immunity check)', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += TAGS.intersects(IMMUNE) ? 1 : 0;
    }
  })
  .add('timing wheel schedule + collect (15% overflow)', () => {
    for (let i = 0; i < BATCH; i++) {
      WHEEL.schedule(tick + 1 + (i % 300), i);
    }

    tick += 1;
    sink += WHEEL.collect(tick, FIRED).length;
  })
  .add('keyed roll, 5-part key (spread)', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += roll(12_345, 7, tick, i, 3, 12, 0);
    }
  })
  .add('keyed roll, 4-part scratch key', () => {
    for (let i = 0; i < BATCH; i++) {
      SCRATCH_KEY[0] = tick;
      SCRATCH_KEY[1] = i;
      sink += rollKey(12_345, 7, SCRATCH_KEY);
    }
  })
  .add('sequential stream draw', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += MAIN();
    }
  })
  .add('modifier fold, two stats (6 sources, gates)', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += MODIFIERS.resolve(SHEET, STATS.id.damage, READ) + MODIFIERS.resolve(SHEET, STATS.id.moveSpeed, READ);
    }
  })
  .add('scaled value evaluation (live folded stats)', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += evaluateScaled(DAMAGE, EVALUATION);
    }
  })
  .add('scaled value finish from a snapshot', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += finishScaled(SNAPSHOT, TARGET);
    }
  })
  .add('scaled cooldown through the haste curve', () => {
    for (let i = 0; i < BATCH; i++) {
      sink += evaluateScaled(COOLDOWN, EVALUATION);
    }
  })
  .add('aura apply x3 + fold two stats', () => {
    for (let i = 0; i < BATCH; i++) {
      AURA_SYSTEM.apply(AURA_BEARER, AURAS.id.might);
      AURA_SYSTEM.apply(AURA_BEARER, AURAS.id.fury);
      AURA_SYSTEM.apply(AURA_BEARER, AURAS.id.haste);
      sink +=
        AURA_MODIFIERS.resolve(AURA_SHEET, AURA_STATS.id.damage, AURA_READ) +
        AURA_MODIFIERS.resolve(AURA_SHEET, AURA_STATS.id.moveSpeed, AURA_READ);
    }
  })
  .add('aura tick, 2,000 bearers x 3 auras (per tick)', () => {
    for (const bearer of HORDE) {
      AURA_SYSTEM.tick(bearer, 'world');
    }
  });

await bench.run();

const rows = bench.tasks.map((task) => {
  const { result } = task;
  const batch = BATCHES.get(task.name) ?? BATCH;
  const nanoseconds = result.state === 'completed' ? (result.latency.mean * 1e6) / batch : Number.NaN;

  return `${task.name.padEnd(48)} ${nanoseconds.toFixed(1).padStart(8)} ns/op`;
});

process.stdout.write(
  `${[`${'benchmark'.padEnd(48)}    per op`, ...rows].join('\n')}\n(sink ${sink > 0 ? 'ok' : 'empty'})\n`,
);
