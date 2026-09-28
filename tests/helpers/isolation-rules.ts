import { dirname, isAbsolute, relative, resolve } from 'node:path';

import ts from 'typescript';

import { type Finding, findingAt, walk } from './source-scan.ts';

/** Where a file's imports may lead. */
export interface ImportPolicy {
  /** The directory every relative import must stay inside (`src/` for the framework, the project root for tests). */
  readonly root: string;

  /** The npm packages the file may import, by package name. */
  readonly packages: ReadonlySet<string>;

  /** Whether `node:` built-ins are allowed: true for tests and benchmarks, never for `src/` (§I.5.5). */
  readonly allowsNodeBuiltins: boolean;
}

/** Globals that exist only in Node or only in a browser, or that schedule work outside the host's clock (§I.5.5). */
const PLATFORM_GLOBALS: ReadonlySet<string> = new Set([
  'Buffer',
  '__dirname',
  '__filename',
  'clearImmediate',
  'document',
  'exports',
  'global',
  'module',
  'process',
  'require',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'window',
]);

/** Members that read a wall clock or an unseeded random source (§I.5, determinism). */
const NONDETERMINISTIC_MEMBERS: ReadonlySet<string> = new Set([
  'Date.now',
  'Math.random',
  'crypto.getRandomValues',
  'crypto.randomUUID',
  'performance.now',
]);

/** The built-ins that have no form other than `new` (§I.5.2). */
const CONSTRUCTIBLE_BUILT_INS: ReadonlySet<string> = new Set([
  'ArrayBuffer',
  'BigInt64Array',
  'BigUint64Array',
  'DataView',
  'Error',
  'Float32Array',
  'Float64Array',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Map',
  'Set',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet',
]);

/** Kebab-case file names, with `.test` allowed before the extension. */
const FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.test)?\.ts$/;

/** The package an import specifier names: `@scope/name` or `name`, without any subpath. */
const packageOf = (specifier: string): string => {
  const parts = specifier.split('/');
  const isScoped = specifier.startsWith('@');

  return (isScoped ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
};

/** Why a module specifier breaks the policy, or undefined when it is allowed. */
const specifierProblem = (specifier: string, fileName: string, policy: ImportPolicy): string | undefined => {
  if (/^@swarm(?:\/|$)|^swarm(?:\/|$)/.test(specifier)) {
    return `imports swarm (${specifier})`;
  }

  if (specifier.startsWith('.')) {
    const path = relative(policy.root, resolve(dirname(fileName), specifier));

    return path.startsWith('..') || isAbsolute(path) ? `imports ${specifier}, outside its root` : undefined;
  }

  if (specifier.startsWith('node:')) {
    return policy.allowsNodeBuiltins ? undefined : `imports the Node built-in ${specifier}`;
  }

  if (specifier.startsWith('/') || isAbsolute(specifier)) {
    return `imports the absolute path ${specifier}`;
  }

  return policy.packages.has(packageOf(specifier)) ? undefined : `imports ${specifier}, not a listed dependency`;
};

/** The module specifier a node imports from, if it is an import or export of any form. */
const importedModule = (node: ts.Node): ts.Expression | undefined => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier;
  }

  if (ts.isExternalModuleReference(node)) {
    return node.expression;
  }

  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return node.argument.literal;
  }

  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node.arguments[0] ?? node;
  }

  return undefined;
};

/**
 * Every import, re-export, `import()` and `import type` of a file that leaves its root, names a Node built-in where
 * none is allowed, names a package not listed in `package.json`, or names swarm.
 */
export const findImportProblems = (source: ts.SourceFile, policy: ImportPolicy): Finding[] => {
  const findings: Finding[] = [];

  walk(source, (node) => {
    const specifier = importedModule(node);

    if (specifier === undefined) {
      return;
    }

    const problem = ts.isStringLiteralLike(specifier)
      ? specifierProblem(specifier.text, source.fileName, policy)
      : 'imports a computed specifier';

    if (problem !== undefined) {
      findings.push(findingAt(specifier, problem));
    }
  });

  return findings;
};

/** Whether an identifier only names something (a property, a declaration, a label) rather than reading a binding. */
const isNameOnly = (id: ts.Identifier): boolean => {
  const parent = id.parent;

  if (ts.isPropertyAccessExpression(parent)) {
    return parent.name === id;
  }

  if (ts.isQualifiedName(parent)) {
    return parent.right === id;
  }

  if (ts.isShorthandPropertyAssignment(parent)) {
    return false;
  }

  return ('name' in parent && parent.name === id) || ('propertyName' in parent && parent.propertyName === id);
};

/** The `object.member` a property or string-keyed element access reads, such as `Math.random`. */
const memberPath = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return `${node.expression.text}.${node.name.text}`;
  }

  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return `${node.expression.text}.${node.argumentExpression.text}`;
  }

  return undefined;
};

/** Why a node reads a platform global, if it does (directly or through `globalThis`). */
const platformProblem = (node: ts.Node): string | undefined => {
  if (ts.isIdentifier(node) && PLATFORM_GLOBALS.has(node.text) && !isNameOnly(node)) {
    return `uses the platform global ${node.text}`;
  }

  const path = memberPath(node);
  const member = path?.startsWith('globalThis.') === true ? path.slice('globalThis.'.length) : undefined;

  return member !== undefined && PLATFORM_GLOBALS.has(member) ? `uses the platform global ${member}` : undefined;
};

/** Every reference to a Node or DOM global, or a host timer, in a file that must run anywhere (§I.5.5). */
export const findPlatformGlobals = (source: ts.SourceFile): Finding[] => {
  const findings: Finding[] = [];

  walk(source, (node) => {
    const problem = platformProblem(node);

    if (problem !== undefined) {
      findings.push(findingAt(node, problem));
    }
  });

  return findings;
};

/** Every read of a wall clock or an unseeded random source (`Math.random`, `Date.now`, `performance.now`, …). */
export const findNondeterminism = (source: ts.SourceFile): Finding[] => {
  const findings: Finding[] = [];

  walk(source, (node) => {
    const path = memberPath(node);

    if (path !== undefined && NONDETERMINISTIC_MEMBERS.has(path)) {
      findings.push(findingAt(node, `reads ${path}`));
    }
  });

  return findings;
};

/**
 * Whether a file is an adapter module: the one place a third-party class may be constructed (§I.5.2). Adapter modules
 * are named `*-adapter.ts`.
 */
const isAdapterModule = (source: ts.SourceFile): boolean => source.fileName.endsWith('-adapter.ts');

/** Why a node breaks the no-class style of §I.5.2, if it does. */
const styleProblem = (node: ts.Node, isAdapter: boolean): string | undefined => {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return 'declares a class';
  }

  if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.ThisType) {
    return 'uses this';
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    return 'uses instanceof';
  }

  if (!ts.isNewExpression(node) || isAdapter) {
    return undefined;
  }

  const callee = node.expression;

  return ts.isIdentifier(callee) && CONSTRUCTIBLE_BUILT_INS.has(callee.text)
    ? undefined
    : `constructs ${callee.getText()} with new outside an adapter module`;
};

/** Every class, `this`, `instanceof`, and `new` of anything but an allowed built-in outside adapter modules. */
export const findStyleProblems = (source: ts.SourceFile): Finding[] => {
  const findings: Finding[] = [];
  const isAdapter = isAdapterModule(source);

  walk(source, (node) => {
    const problem = styleProblem(node, isAdapter);

    if (problem !== undefined) {
      findings.push(findingAt(node, problem));
    }
  });

  return findings;
};

/** Whether a file's name is kebab-case (§I.4.2). */
export const hasKebabCaseName = (source: ts.SourceFile): boolean => {
  const name = source.fileName.split(/[\\/]/).at(-1) ?? '';

  return FILE_NAME.test(name);
};
