/**
 * What V8's optimiser did while some benchmarks ran: `npm run bench jit <filter> [function]`. It runs the rows the
 * filter picks under `--trace-deopt` and `--trace-turbo-inlining`, keeps the whole trace in `.bench/jit.txt`, and
 * prints the deoptimisations (by function and reason) and the calls TurboFan would not inline. With a function name,
 * it lists only what concerns that function: where it was inlined, what it inlined, and why it was not.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** How many lines each section shows. */
const TOP = 25;

const [filter, only] = process.argv.slice(2);

if (filter === undefined) {
  process.stderr.write('Usage: npm run bench jit <filter> [function]\n');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const flags = ['--expose-gc', '--trace-deopt', '--trace-turbo-inlining'];

const trace = execFileSync(process.execPath, [...flags, 'bench/run.ts', filter, '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 1024
});

mkdirSync(join(root, '.bench'), { recursive: true });
writeFileSync(join(root, '.bench', 'jit.txt'), trace);

/** Counts each key a pattern finds in the trace, most frequent first. */
const tally = (pattern: RegExp, keyOf: (match: RegExpMatchArray) => string | undefined): [string, number][] => {
  const counts = new Map<string, number>();

  for (const match of trace.matchAll(pattern)) {
    const key = keyOf(match);

    if (key !== undefined && (only === undefined || key.includes(only))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts].toSorted((a, b) => b[1] - a[1]).slice(0, TOP);
};

/** A V8 object reference's name: `<JSFunction applyIn (sfi = …)>` or `<SharedFunctionInfo applyIn>` gives `applyIn`. */
const NAME = String.raw`<(?:JSFunction|SharedFunctionInfo) ?([^ (>]*)`;

/** A captured name, or `(anonymous)` for a function with none. */
const named = (name: string | undefined): string => (name === undefined || name === '' ? '(anonymous)' : name);

const deopts = tally(
  new RegExp(String.raw`\[bailout \(kind: ([^,]+), reason: ([^)]+)\): begin\. deoptimizing [^<]*${NAME}`, 'g'),
  (match) => `${named(match[3])}: ${match[2]} (${match[1]})`
);

const inlined = tally(
  new RegExp(String.raw`^Inlining [^{]*\{[^<]*${NAME}[^}]*\} into [^{]*\{[^<]*${NAME}`, 'gm'),
  (match) => (only === undefined ? undefined : `${named(match[1])} into ${named(match[2])}`)
);

const refused = tally(
  new RegExp(String.raw`^Cannot consider [^{]*\{[^<]*${NAME}[^}]*\} for inlining \(([^)]*)\)`, 'gm'),
  (match) => `${named(match[1])}: ${match[2]}`
);

/** One section: a title, then each counted line. */
const section = (title: string, rows: readonly [string, number][]): string =>
  `${title}\n${rows.length === 0 ? '  (none)' : rows.map(([key, count]) => `${String(count).padStart(6)}  ${key}`).join('\n')}`;

const sections = [
  section('Deoptimisations (function: reason)', deopts),
  section('Not inlined (function: reason)', refused),
  ...(only === undefined ? [] : [section(`Inlined (${only})`, inlined)])
];

process.stdout.write(`${sections.join('\n\n')}\n\nThe whole trace is in .bench/jit.txt.\n`);
