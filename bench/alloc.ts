/**
 * What each benchmark row allocates: `node bench/alloc.ts [filter] [--sites[=N]]`. Each row the filter picks runs
 * warm, then under V8's sampling heap profiler with collected objects included, so short-lived garbage counts; it
 * prints the bytes a run allocates and, with `--sites`, the N sites (8 by default) that allocate most, each with its
 * callers. Inlined callees allocate in their caller's name: run it under `--no-turbo-inlining --no-maglev-inlining`
 * to see them apart, knowing that numbers then show boxing that inlining would have spared.
 */
import { Session } from 'node:inspector/promises';

import { ABILITY_TASKS } from './abilities.ts';
import { AREA_TASKS } from './area-triggers.ts';
import { LOG_TASKS } from './combat-log.ts';
import { CORE_TASKS } from './core.ts';
import { CUE_TASKS } from './cues.ts';
import { DAMAGE_TASKS } from './damage.ts';
import { PROC_TRIGGER_TASKS } from './procs-triggers.ts';
import { SPELL_TASKS } from './spells.ts';
import { UNIT_TASKS } from './units.ts';
import { WORLD_TASKS } from './world.ts';

/** A node of V8's sampling heap profile. */
interface ProfileNode {
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
  readonly selfSize: number;
  readonly children: readonly ProfileNode[];
}

/** One row: its name and one operation. */
type Row = readonly [string, () => void];

/** The bytes between samples: small, so a row of a few hundred bytes a run is still seen. */
const INTERVAL = 256;

/** How long a row runs warm, and then sampled, in milliseconds, with at least `MIN_RUNS` runs each time. */
const WARM_MS = 100;
const SAMPLE_MS = 250;
const MIN_RUNS = 200;

const args = process.argv.slice(2);
const pattern = args.find((arg) => !arg.startsWith('--'));
const filter = pattern === undefined ? undefined : new RegExp(pattern, 'i');
const sitesArg = args.find((arg) => arg.startsWith('--sites'));
const sites = sitesArg === undefined ? 0 : Number(sitesArg.split('=')[1] ?? 8);
const root = new URL('..', import.meta.url).href;

/** Runs a row until both a time and a count are reached; returns how many runs it made. */
const runFor = (task: () => void, ms: number): number => {
  const until = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
  let runs = 0;

  while (runs < MIN_RUNS || process.hrtime.bigint() < until) {
    task();
    runs += 1;
  }

  return runs;
};

/** Where a profile node allocates: its function, file (from the repository root) and line. */
const placeOf = (node: ProfileNode): string => {
  const { functionName, url, lineNumber } = node.callFrame;

  return `${functionName === '' ? '(anonymous)' : functionName} ${url.replace(root, '')}:${lineNumber + 1}`;
};

/** Sums a profile's sampled bytes by site and its two callers, leaving out the profiler's own work. */
const sitesOf = (head: ProfileNode): { total: number; bySite: Map<string, number> } => {
  const bySite = new Map<string, number>();
  let total = 0;

  const walk = (node: ProfileNode, callers: readonly string[]): void => {
    const place = placeOf(node);

    if (node.selfSize > 0 && !node.callFrame.url.startsWith('node:')) {
      const key = [place, ...callers.slice(-2).toReversed()].join('  <- ');

      total += node.selfSize;
      bySite.set(key, (bySite.get(key) ?? 0) + node.selfSize);
    }

    for (const child of node.children) {
      walk(child, [...callers, place.replace(/ .*:/, ':')]);
    }
  };

  walk(head, []);

  return { total, bySite };
};

const session = new Session();

session.connect();
await session.post('HeapProfiler.enable');

/** Measures one row and prints what it allocates per run. */
const measure = async ([name, task]: Row): Promise<void> => {
  runFor(task, WARM_MS);
  await session.post('HeapProfiler.startSampling', {
    samplingInterval: INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true
  });

  const runs = runFor(task, SAMPLE_MS);
  const { profile } = await session.post('HeapProfiler.stopSampling');
  const { total, bySite } = sitesOf(profile.head);
  const bytes = total / runs;
  const shown = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes.toFixed(0)} B`;

  process.stdout.write(`${shown.padStart(10)}  ${name}\n`);

  for (const [site, size] of [...bySite].toSorted((a, b) => b[1] - a[1]).slice(0, sites)) {
    process.stdout.write(`${''.padStart(10)}    ${((size / total) * 100).toFixed(0).padStart(3)}%  ${site}\n`);
  }
};

/** Measures each row of a list the filter picks. */
const measureAll = async (rows: readonly Row[]): Promise<void> => {
  for (const row of rows) {
    if (filter === undefined || filter.test(row[0])) {
      await measure(row);
    }
  }
};

process.stdout.write(`${'per run'.padStart(10)}  row\n`);
await measureAll([
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
]);

// The whole-game horde and the co-op game load late, as in `run.ts`, and only when the filter wants them.
if (filter === undefined || filter.test('horde: 2,000 mobs + 4 heroes, the whole unit game (tick)')) {
  await measureAll((await import('./horde.ts')).HORDE_TASKS);
}

if (filter === undefined || filter.test('co-op: 350 mobs on 4 heroes, 60 Hz, fields + AoE (tick)')) {
  await measureAll((await import('./coop.ts')).COOP_TASKS);
}

session.disconnect();
