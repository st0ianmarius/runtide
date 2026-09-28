import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findMissingDocs, findPresentationFields } from './helpers/docs-rules.ts';
import { loadSources, parseSource, PROJECT_ROOT } from './helpers/source-scan.ts';

/**
 * Exported fields allowed to carry a presentation-like name, as `TypeName.field`, each one developer-facing (§I.5.3).
 * Empty until a system needs one.
 */
const PRESENTATION_ALLOWLIST: ReadonlySet<string> = new Set<string>();

const src = loadSources('src');

/** Parses an in-memory snippet as if it lived at `src/<name>`. */
const snippet = (name: string, text: string) => parseSource(join(PROJECT_ROOT, 'src', name), text);

describe('the docs checker', () => {
  it('flags every undocumented exported declaration and accepts documented ones', () => {
    const text = [
      'export const LIMIT = 3;',
      'export function run(): void {}',
      'export type Id = number;',
      '/** A documented constant. */',
      'export const DOCUMENTED = 1;',
      '/** A documented function. */',
      'export const create = (): number => 1;',
      'const hidden = 2;',
      'const listed = 3;',
      'export { listed };',
    ].join('\n');

    assert.deepEqual(findMissingDocs(snippet('a.ts', text)), [
      'src/a.ts:1 exports LIMIT without a doc block',
      'src/a.ts:2 exports run without a doc block',
      'src/a.ts:3 exports Id without a doc block',
      'src/a.ts:9 exports listed without a doc block',
    ]);
  });

  it('flags undocumented fields and hooks of exported types, however nested', () => {
    const text = [
      '/** A definition. */',
      'export interface AuraDef {',
      '  /** How long it lasts, in seconds. */',
      '  readonly duration: number;',
      '  readonly maxStacks: number;',
      '  onExpire(target: number): void;',
      '}',
      '/** A shape. */',
      'export type Shape = { readonly kind: "circle"; /** The radius. */ readonly r: number };',
      'interface Internal { readonly free: number }',
    ].join('\n');

    assert.deepEqual(findMissingDocs(snippet('a.ts', text)), [
      'src/a.ts:5 AuraDef.maxStacks has no doc block',
      'src/a.ts:6 AuraDef.onExpire has no doc block',
      'src/a.ts:9 Shape.kind has no doc block',
    ]);
  });

  it('rejects an empty doc block and a plain comment', () => {
    const text = ['/** */', 'export const A = 1;', '/* not a doc block */', 'export const B = 2;'].join('\n');

    assert.deepEqual(findMissingDocs(snippet('a.ts', text)), [
      'src/a.ts:2 exports A without a doc block',
      'src/a.ts:4 exports B without a doc block',
    ]);
  });

  it('flags presentation-named fields of exported types unless allowlisted', () => {
    const text = [
      'export interface SpellDef { readonly name: string; readonly Icon: number; readonly range: number }',
      'export type Cue = { readonly params: { readonly color: number } };',
      'interface Internal { readonly label: string }',
    ].join('\n');

    assert.deepEqual(findPresentationFields(snippet('a.ts', text), new Set()), [
      'src/a.ts:1 SpellDef.name is a presentation field',
      'src/a.ts:1 SpellDef.Icon is a presentation field',
      'src/a.ts:2 Cue.color is a presentation field',
    ]);
    assert.deepEqual(findPresentationFields(snippet('a.ts', text), new Set(['SpellDef.name', 'SpellDef.Icon'])), [
      'src/a.ts:2 Cue.color is a presentation field',
    ]);
  });
});

describe('src documentation', () => {
  it('has sources to scan', () => {
    assert.ok(src.length > 0);
  });

  it('documents every exported declaration, field and hook', () => {
    assert.deepEqual(src.flatMap(findMissingDocs), []);
  });

  it('exports no presentation-named field outside the allowlist', () => {
    assert.deepEqual(
      src.flatMap((source) => findPresentationFields(source, PRESENTATION_ALLOWLIST)),
      [],
    );
  });
});
