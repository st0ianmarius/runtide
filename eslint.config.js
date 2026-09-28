import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

/** Built-ins that have no form other than `new` (§I.5.2); `isolation.test.ts` keeps the same list. */
const CONSTRUCTIBLE_BUILT_INS = [
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
];

/** Adapter modules: the only files that may construct a third-party class (§I.5.2). */
const ADAPTER_MODULES = ['src/**/*-adapter.ts'];

/** The no-class style of §I.5.2, for every file. */
const NO_CLASS_STYLE = [
  {
    selector: 'ClassDeclaration',
    message: 'No classes: use plain objects and factory functions (§I.5.2).',
  },
  {
    selector: 'ClassExpression',
    message: 'No classes: use plain objects and factory functions (§I.5.2).',
  },
  {
    selector: 'ThisExpression',
    message: 'No `this`: hooks receive what they need as arguments (§I.5.2).',
  },
  {
    selector: 'TSThisType',
    message: 'No `this`: hooks receive what they need as arguments (§I.5.2).',
  },
  {
    selector: "BinaryExpression[operator='instanceof']",
    message: 'No `instanceof`: narrow on a `kind` field or a type guard (§I.5.2).',
  },
];

/** `new` outside the built-in allowlist, for every file but the adapter modules. */
const NO_FOREIGN_NEW = {
  selector: `NewExpression:not([callee.type='Identifier'][callee.name=/^(${CONSTRUCTIBLE_BUILT_INS.join('|')})$/])`,
  message: '`new` only for Map, Set, WeakMap, WeakSet, typed arrays, ArrayBuffer, DataView and Error (§I.5.2).',
};

/** Globals `src/` never reads: Node, the DOM and host timers (§I.5.5). */
const PLATFORM_GLOBALS = [
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
].map((name) => ({
  name,
  message: 'src/ runs anywhere: no Node or DOM globals, no host timers (§I.5.5).',
}));

/** Wall clocks and unseeded randomness (§I.5, determinism). */
const NONDETERMINISM = [
  ['Math', 'random'],
  ['Date', 'now'],
  ['performance', 'now'],
  ['crypto', 'getRandomValues'],
  ['crypto', 'randomUUID'],
].map(([object, property]) => ({
  object,
  property,
  message: 'Deterministic: randomness and time come from the host (§I.5).',
}));

/** Whether an object-literal property is a function that spans several lines. */
const isMultilineFunction = (property) => {
  const value = property.type === 'Property' ? property.value : undefined;
  const isFunction = value?.type === 'ArrowFunctionExpression' || value?.type === 'FunctionExpression';

  return isFunction && property.loc.start.line !== property.loc.end.line;
};

/** Reports a missing blank line between two neighbouring properties, with a fix that adds one. */
const requireBlankLine = (context, previous, next) => {
  const sourceCode = context.sourceCode;
  const comma = sourceCode.getTokenAfter(previous);
  const following = sourceCode.getTokenAfter(comma, { includeComments: true });
  const gap = following.loc.start.line - comma.loc.end.line;

  if (gap !== 1) {
    return;
  }

  context.report({
    node: next,
    messageId: 'blankLine',
    fix: (fixer) => fixer.insertTextAfter(comma, '\n'),
  });
};

/** A blank line around every multi-line function in an object literal (§I.4.2), autofixable. */
const paddedObjectFunctions = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: {
      blankLine: 'Expected a blank line around a multi-line function property.',
    },
  },

  create: (context) => ({
    ObjectExpression: (node) => {
      node.properties.slice(1).forEach((next, index) => {
        const previous = node.properties[index];

        if (isMultilineFunction(previous) || isMultilineFunction(next)) {
          requireBlankLine(context, previous, next);
        }
      });
    },
  }),
};

/** A to-do comment names its issue, as `TODO(#12)` does (§I.4.2). */
const todoWithIssue = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: { issue: 'A TODO or FIXME names its issue, as TODO(#12).' },
  },

  create: (context) => ({
    Program: () => {
      for (const comment of context.sourceCode.getAllComments()) {
        if (/\b(?:TODO|FIXME)\b(?!\(#\d+\))/.test(comment.value)) {
          context.report({ loc: comment.loc, messageId: 'issue' });
        }
      }
    },
  }),
};

const local = {
  rules: {
    'padded-object-functions': paddedObjectFunctions,
    'todo-with-issue': todoWithIssue,
  },
};

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  jsdoc.configs['flat/recommended-typescript-error'],
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: {
      '@stylistic': stylistic,
      'simple-import-sort': simpleImportSort,
      local,
    },
    rules: {
      'local/padded-object-functions': 'error',
      'local/todo-with-issue': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        {
          blankLine: 'always',
          prev: '*',
          next: ['function', 'multiline-export', 'multiline-const'],
        },
        {
          blankLine: 'always',
          prev: ['function', 'multiline-export', 'multiline-const'],
          next: '*',
        },
      ],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-console': 'error',
      'no-nested-ternary': 'error',
      'no-restricted-syntax': ['error', ...NO_CLASS_STYLE, NO_FOREIGN_NEW],
      'no-restricted-properties': ['error', ...NONDETERMINISM],
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
          },
        },
      ],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400 }],
      complexity: ['error', 12],
      'max-depth': ['error', 3],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['describe', 'it', 'suite', 'test'],
            },
          ],
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
        },
      ],
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        {
          selector: 'variable',
          modifiers: ['global', 'const'],
          format: ['camelCase', 'UPPER_CASE'],
        },
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: ['variable', 'parameter'],
          types: ['boolean'],
          format: ['PascalCase', 'UPPER_CASE'],
          prefix: ['is', 'has', 'can', 'should', 'was', 'did', 'will', 'IS_', 'HAS_', 'CAN_'],
        },
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          modifiers: ['requiresQuotes'],
          format: null,
        },
      ],
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSPropertySignature',
            'TSMethodSignature',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
        },
      ],
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-description': 'error',
      'jsdoc/require-description-complete-sentence': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...PLATFORM_GLOBALS],
    },
  },
  {
    files: ADAPTER_MODULES,
    rules: {
      'no-restricted-syntax': ['error', ...NO_CLASS_STYLE],
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },
  {
    files: ['tests/**/*.ts', 'bench/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/naming-convention': 'off',
      'no-restricted-exports': 'off',
    },
  },
  prettier,
  {
    // Rules eslint-config-prettier switches off as "special": both are safe beside Prettier with these options.
    rules: {
      curly: ['error', 'all'],
      '@stylistic/lines-around-comment': [
        'error',
        {
          beforeBlockComment: true,
          allowBlockStart: true,
          allowObjectStart: true,
          allowArrayStart: true,
          allowClassStart: true,
          allowInterfaceStart: true,
          allowTypeStart: true,
          allowEnumStart: true,
          allowModuleStart: true,
        },
      ],
    },
  },
);
