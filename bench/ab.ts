/**
 * Compares the benchmarks of a commit with the working tree: `node bench/ab.ts <ref> [filter]`. The ref is checked
 * out in a temporary worktree, which takes the working tree's `bench/` (the same rows over the ref's `src/`, so a ref
 * whose API the rows no longer fit fails), and both run twice, alternating, each row keeping its faster median.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** A change smaller than this share is noise on a laptop: it is shown, but not flagged. */
const NOISE = 0.05;

/** How many times each side runs, alternating, so drift on the machine hits both alike. */
const ROUNDS = 2;

const [ref, filter] = process.argv.slice(2);

if (ref === undefined) {
  process.stderr.write('Usage: node bench/ab.ts <ref> [filter]\n');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const base = mkdtempSync(join(tmpdir(), 'runtide-ab-'));

/** Runs git in the working tree. */
const git = (...args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

/** Runs the benchmarks of one tree as JSON: each row's median nanoseconds per operation, by name. */
const measure = (cwd: string): Map<string, number> => {
  const args = ['--expose-gc', 'bench/run.ts', ...(filter === undefined ? [] : [filter]), '--json'];
  const out = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const parsed: unknown = JSON.parse(out.trim().split('\n').at(-1) ?? '{}');

  return new Map(
    typeof parsed === 'object' && parsed !== null
      ? Object.entries(parsed).flatMap(([name, value]) => (typeof value === 'number' ? [[name, value] as const] : []))
      : []
  );
};

/** A time in nanoseconds, in the unit that reads best. */
const time = (ns: number | undefined): string => {
  if (ns === undefined) {
    return '—';
  }

  if (ns >= 1e6) {
    return `${(ns / 1e6).toFixed(2)} ms`;
  }

  return ns >= 1e3 ? `${(ns / 1e3).toFixed(2)} µs` : `${ns.toFixed(2)} ns`;
};

/** Keeps each row's faster median of two runs. */
const faster = (into: Map<string, number>, from: Map<string, number>): void => {
  for (const [name, ns] of from) {
    into.set(name, Math.min(into.get(name) ?? Infinity, ns));
  }
};

try {
  git('worktree', 'add', '--detach', base, ref);
  rmSync(join(base, 'bench'), { recursive: true, force: true });
  cpSync(join(root, 'bench'), join(base, 'bench'), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(base, 'node_modules'));

  const before = new Map<string, number>();
  const after = new Map<string, number>();

  for (let round = 0; round < ROUNDS; round++) {
    process.stderr.write(`round ${round + 1} of ${ROUNDS}: ${ref}, then the working tree\n`);
    faster(before, measure(base));
    faster(after, measure(root));
  }

  const names = [...new Set([...before.keys(), ...after.keys()])];
  const width = Math.max(9, ...names.map((name) => name.length));

  const lines = names.map((name) => {
    const [was, now] = [before.get(name), after.get(name)];
    const change = was === undefined || now === undefined ? undefined : now / was - 1;
    const flag = change === undefined || Math.abs(change) < NOISE ? '' : `  ${change > 0 ? 'slower' : 'faster'}`;
    const shown = change === undefined ? '' : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;

    return `${name.padEnd(width)} ${time(was).padStart(11)} ${time(now).padStart(11)} ${shown.padStart(8)}${flag}`;
  });

  const head = `${'benchmark'.padEnd(width)} ${ref.slice(0, 11).padStart(11)} ${'working'.padStart(11)} ${'change'.padStart(8)}`;

  process.stdout.write(`${[head, '-'.repeat(head.length), ...lines].join('\n')}\n`);
} finally {
  git('worktree', 'remove', '--force', base);
}
