import { Bench } from 'tinybench';

import { createBitset, createRegistry, createTimingWheel, type Id, roll, rollKey, stream } from '../src/core/index.ts';

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
  });

await bench.run();

const rows = bench.tasks.map((task) => {
  const { result } = task;
  const nanoseconds = result.state === 'completed' ? (result.latency.mean * 1e6) / BATCH : Number.NaN;

  return `${task.name.padEnd(48)} ${nanoseconds.toFixed(1).padStart(8)} ns/op`;
});

process.stdout.write(
  `${[`${'benchmark'.padEnd(48)}    per op`, ...rows].join('\n')}\n(sink ${sink > 0 ? 'ok' : 'empty'})\n`,
);
