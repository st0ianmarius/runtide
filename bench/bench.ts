/**
 * The one entry to the benchmarks: `npm run bench [mode] [args]`. The first argument picks the mode, anything else is
 * the runner's own arguments:
 *
 * - (none): runs the rows, `[filter] [--json]` (`run.ts`);
 * - `ab <ref> [filter]`: a commit against the working tree (`ab.ts`);
 * - `alloc [filter] [--sites[=N]]`: what each row allocates (`alloc.ts`);
 * - `jit <filter> [function]`: the optimiser's deoptimisations and inlining (`jit.ts`);
 * - `prof [filter]`: the rows under a CPU profile, written to `.bench/`.
 *
 * Flags reach the runner after npm's `--`: `npm run bench -- alloc spells --sites`.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** What the rows run with, when no mode is named: Node's flags and the script. */
const RUN: readonly string[] = ['--expose-gc', 'bench/run.ts'];

/** What each mode runs: Node's flags and the script. */
const MODES: Readonly<Record<string, readonly string[]>> = {
  run: RUN,
  ab: ['bench/ab.ts'],
  alloc: ['bench/alloc.ts'],
  jit: ['bench/jit.ts'],
  prof: ['--expose-gc', '--cpu-prof', '--cpu-prof-dir=.bench', 'bench/run.ts']
};

const [first, ...rest] = process.argv.slice(2);
const named = first !== undefined && Object.hasOwn(MODES, first) ? MODES[first] : undefined;
const command = named ?? RUN;
const args = named === undefined ? process.argv.slice(2) : rest;

const { status, signal } = spawnSync(process.execPath, [...command, ...args], {
  cwd: resolve(import.meta.dirname, '..'),
  stdio: 'inherit'
});

process.exitCode = status ?? (signal === null ? 1 : 128);
