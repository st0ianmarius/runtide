import { bench, do_not_optimize, run } from 'mitata';

import { ABILITY_TASKS, abilityCounter } from './abilities.ts';
import { AREA_TASKS, areaCounter, areaStats } from './area-triggers.ts';
import { LOG_TASKS, logCounter } from './combat-log.ts';
import { CORE_TASKS, coreCounter } from './core.ts';
import { CUE_TASKS, CUE_TICK_BYTES, cueCounter } from './cues.ts';
import { DAMAGE_TASKS, damageCounter } from './damage.ts';
import { counter, PROC_TRIGGER_TASKS } from './procs-triggers.ts';
import { SPELL_TASKS, spellCounter, spellHordeStats } from './spells.ts';
import { UNIT_TASKS, unitCounter } from './units.ts';
import { WORLD_TASKS, worldCounter } from './world.ts';

/**
 * How the runner is asked: `npm run bench -- [filter] [--json]`. The filter (a case-blind pattern) picks the rows to
 * run; `--json` prints only each row's median nanoseconds per operation, by name, for `bench/ab.ts` to compare (a
 * median, as the garbage collector's pauses swing a mean from run to run).
 */
const ARGS = process.argv.slice(2);
const IS_JSON = ARGS.includes('--json');
const PATTERN = ARGS.find((arg) => !arg.startsWith('--'));
const FILTER = PATTERN === undefined ? undefined : new RegExp(PATTERN, 'i');

/** Every row, in order: the core's, then each system's. */
const ROWS: readonly (readonly [string, () => void])[] = [
  ...CORE_TASKS,
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
      do_not_optimize(coreCounter.sink);
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

const sink =
  coreCounter.sink +
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
