import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

/** The repository root, the directory that holds `package.json`. */
export const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * One broken rule, as `path:line message` with the path relative to the project root, so a failing assertion lists
 * every place to fix.
 */
export type Finding = string;

/**
 * Parses TypeScript source text into a syntax tree with parent links. Nothing is type-checked and nothing touches the
 * disk, so the self-tests can feed it in-memory snippets under a virtual path.
 */
export const parseSource = (path: string, text: string): ts.SourceFile =>
  ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/**
 * Parses every `.ts` file under a directory of the project, sorted by path. A directory that does not exist yet (such
 * as `bench/` before its first benchmark) yields no files.
 */
export const loadSources = (directory: string): readonly ts.SourceFile[] => {
  const root = join(PROJECT_ROOT, directory);

  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .sort()
    .map((path) => join(root, path))
    .map((path) => parseSource(path, readFileSync(path, 'utf8')));
};

/** Calls `visit` on a node and on every node below it, parents before children, in source order. */
export const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
  visit(node);
  ts.forEachChild(node, (child) => {
    walk(child, visit);
  });
};

/** A source file's path relative to the project root, with `/` separators on every platform. */
const projectPath = (source: ts.SourceFile): string => relative(PROJECT_ROOT, source.fileName).split(sep).join('/');

/** Formats a finding for the node's first line. */
export const findingAt = (node: ts.Node, message: string): Finding => {
  const source = node.getSourceFile();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));

  return `${projectPath(source)}:${String(line + 1)} ${message}`;
};
