import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  findImportProblems,
  findNondeterminism,
  findPlatformGlobals,
  findStyleProblems,
  hasKebabCaseName,
  type ImportPolicy,
} from './helpers/isolation-rules.ts';
import { listedPackages } from './helpers/package-manifest.ts';
import { loadSources, parseSource, PROJECT_ROOT } from './helpers/source-scan.ts';

const runtimePackages = listedPackages('dependencies');
const devPackages = listedPackages('devDependencies');

/** The policy for `src/`: relative imports inside `src/`, runtime dependencies only, no Node built-ins. */
const SRC_POLICY: ImportPolicy = {
  root: join(PROJECT_ROOT, 'src'),
  packages: runtimePackages,
  allowsNodeBuiltins: false,
};

/** The policy for tests and benchmarks: anywhere in the project, any listed package, and Node built-ins. */
const DEV_POLICY: ImportPolicy = {
  root: PROJECT_ROOT,
  packages: new Set([...runtimePackages, ...devPackages]),
  allowsNodeBuiltins: true,
};

const src = loadSources('src');
const devCode = [...loadSources('tests'), ...loadSources('bench')];

/** Parses an in-memory snippet as if it lived at `path`, relative to the project root. */
const snippet = (path: string, text: string) => parseSource(join(PROJECT_ROOT, path), text);

describe('the isolation scanner', () => {
  it('flags a Node built-in in src and allows it in tests', () => {
    const text = "import { readFileSync } from 'node:fs';";

    assert.deepEqual(findImportProblems(snippet('src/a.ts', text), SRC_POLICY), [
      'src/a.ts:1 imports the Node built-in node:fs',
    ]);
    assert.deepEqual(findImportProblems(snippet('tests/a.test.ts', text), DEV_POLICY), []);
  });

  it('flags packages that package.json does not list, in every import form', () => {
    const text = [
      "import 'left-pad';",
      "export { x } from 'lodash/fp';",
      "type T = import('zod').ZodType;",
      "const m = await import('rxjs');",
      "import fs = require('fs');",
    ].join('\n');

    assert.deepEqual(findImportProblems(snippet('src/a.ts', text), SRC_POLICY), [
      'src/a.ts:1 imports left-pad, not a listed dependency',
      'src/a.ts:2 imports lodash/fp, not a listed dependency',
      'src/a.ts:3 imports zod, not a listed dependency',
      'src/a.ts:4 imports rxjs, not a listed dependency',
      'src/a.ts:5 imports fs, not a listed dependency',
    ]);
  });

  it('flags dev dependencies in src and allows them in tests', () => {
    const text = "import fc from 'fast-check';";

    assert.deepEqual(findImportProblems(snippet('src/a.ts', text), SRC_POLICY), [
      'src/a.ts:1 imports fast-check, not a listed dependency',
    ]);
    assert.deepEqual(findImportProblems(snippet('tests/a.test.ts', text), DEV_POLICY), []);
  });

  it('flags swarm everywhere, however it is named', () => {
    const text = "import type { Vec } from '@swarm/types';\nimport { Game } from 'swarm/game';";

    assert.deepEqual(findImportProblems(snippet('tests/a.test.ts', text), DEV_POLICY), [
      'tests/a.test.ts:1 imports swarm (@swarm/types)',
      'tests/a.test.ts:2 imports swarm (swarm/game)',
    ]);
  });

  it('flags relative imports that leave their root, and computed specifiers', () => {
    const text = [
      "import { a } from '../../tests/helpers/x.ts';",
      "import { b } from '../../../cryptwave/packages/game/src/index.ts';",
      'const c = await import(name);',
    ].join('\n');

    assert.deepEqual(findImportProblems(snippet('src/core/a.ts', text), SRC_POLICY), [
      'src/core/a.ts:1 imports ../../tests/helpers/x.ts, outside its root',
      'src/core/a.ts:2 imports ../../../cryptwave/packages/game/src/index.ts, outside its root',
      'src/core/a.ts:3 imports a computed specifier',
    ]);
  });

  it('allows relative imports inside the root and listed packages with subpaths', () => {
    const text = [
      "import { a } from './b.ts';",
      "import { c } from '../math/d.ts';",
      "import Flatbush from 'flatbush';",
      "import { x } from 'kdbush/sub';",
    ].join('\n');

    assert.deepEqual(findImportProblems(snippet('src/core/a.ts', text), SRC_POLICY), []);
  });

  it('flags Node and DOM globals, directly and through globalThis, but not property names', () => {
    const text = [
      'const env = process.env;',
      'const bytes = Buffer.from([]);',
      'const w = globalThis.window;',
      'setTimeout(() => {}, 0);',
      'const safe = { process: 1, module: 2 };',
      'const read = safe.process + safe.module;',
      'interface Host { readonly document: number }',
    ].join('\n');

    assert.deepEqual(findPlatformGlobals(snippet('src/a.ts', text)), [
      'src/a.ts:1 uses the platform global process',
      'src/a.ts:2 uses the platform global Buffer',
      'src/a.ts:3 uses the platform global window',
      'src/a.ts:4 uses the platform global setTimeout',
    ]);
  });

  it('flags wall clocks and unseeded randomness', () => {
    const text = [
      'const r = Math.random();',
      'const t = Date.now();',
      "const p = performance['now']();",
      'const u = crypto.randomUUID();',
      'const fine = Math.imul(r, 3) + Math.floor(t);',
    ].join('\n');

    assert.deepEqual(findNondeterminism(snippet('src/a.ts', text)), [
      'src/a.ts:1 reads Math.random',
      'src/a.ts:2 reads Date.now',
      'src/a.ts:3 reads performance.now',
      'src/a.ts:4 reads crypto.randomUUID',
    ]);
  });

  it('flags classes, this and instanceof', () => {
    const text = [
      'class Aura {}',
      'const Spell = class {};',
      'function f() { return this; }',
      'const is = x instanceof Array;',
    ].join('\n');

    assert.deepEqual(findStyleProblems(snippet('src/a.ts', text)), [
      'src/a.ts:1 declares a class',
      'src/a.ts:2 declares a class',
      'src/a.ts:3 uses this',
      'src/a.ts:4 uses instanceof',
    ]);
  });

  it('allows new only for constructible built-ins, and anything in an adapter module', () => {
    const text = [
      'const m = new Map<number, number>();',
      'const f = new Float64Array(8);',
      "const e = new Error('bad');",
      'const d = new Date();',
      'const i = new Flatbush(10);',
    ].join('\n');

    assert.deepEqual(findStyleProblems(snippet('src/a.ts', text)), [
      'src/a.ts:4 constructs Date with new outside an adapter module',
      'src/a.ts:5 constructs Flatbush with new outside an adapter module',
    ]);
    assert.deepEqual(findStyleProblems(snippet('src/world/flatbush-adapter.ts', text)), []);
  });

  it('accepts kebab-case file names only', () => {
    assert.equal(hasKebabCaseName(snippet('src/area-triggers/hit-policy.ts', '')), true);
    assert.equal(hasKebabCaseName(snippet('tests/core/random.test.ts', '')), true);
    assert.equal(hasKebabCaseName(snippet('src/core/hitPolicy.ts', '')), false);
    assert.equal(hasKebabCaseName(snippet('src/core/hit_policy.ts', '')), false);
  });
});

describe('src is isolated and runs anywhere', () => {
  it('has sources to scan', () => {
    assert.ok(src.length > 0);
  });

  it('imports only itself and the runtime dependencies, never Node or swarm', () => {
    assert.deepEqual(
      src.flatMap((source) => findImportProblems(source, SRC_POLICY)),
      [],
    );
  });

  it('uses no Node or DOM global and no host timer', () => {
    assert.deepEqual(src.flatMap(findPlatformGlobals), []);
  });

  it('reads no wall clock and no unseeded randomness', () => {
    assert.deepEqual(src.flatMap(findNondeterminism), []);
  });

  it('has no class, this, instanceof, or new outside the allowlist', () => {
    assert.deepEqual(src.flatMap(findStyleProblems), []);
  });
});

describe('tests and benchmarks keep the same rules', () => {
  it('import only the project, Node built-ins and listed packages, never swarm', () => {
    assert.deepEqual(
      devCode.flatMap((source) => findImportProblems(source, DEV_POLICY)),
      [],
    );
  });

  it('read no wall clock and no unseeded randomness', () => {
    assert.deepEqual(loadSources('tests').flatMap(findNondeterminism), []);
  });

  it('have no class, this, instanceof, or new outside the allowlist', () => {
    assert.deepEqual(devCode.flatMap(findStyleProblems), []);
  });
});

describe('file names', () => {
  it('are kebab-case in src, tests and bench', () => {
    assert.deepEqual(
      [...src, ...devCode].filter((source) => !hasKebabCaseName(source)).map((source) => source.fileName),
      [],
    );
  });
});
