/**
 * Project rules for oxlint's JS plugin API (§I.4.2, §I.5.2): the checks oxlint has no native rule for. Each rule is
 * syntactic, so it needs no type information.
 */

/** Built-ins that have no form other than `new` (§I.5.2). */

const CAMEL_CASE = /^_?[a-z][a-zA-Z0-9]*$/;
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const UPPER_CASE = /^[A-Z][A-Z0-9_]*$/;
const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;

/** Compares two strings the way `simple-import-sort` does: case-insensitive, numbers by value. */
const compareNames = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }) || (a < b ? -1 : 1);

/** A to-do comment names its issue, as `TODO(#12)` does (§I.4.2). */
const todoWithIssue = {
  meta: { type: 'suggestion', schema: [] },

  create: (context) => ({
    Program: () => {
      for (const comment of context.sourceCode.getAllComments()) {
        if (/\b(?:TODO|FIXME)\b(?!\(#\d+\))/.test(comment.value)) {
          context.report({ loc: comment.loc, message: 'A TODO or FIXME names its issue, as TODO(#12).' });
        }
      }
    },
  }),
};

/** The line (1-based) of a character offset. */
const lineAt = (sourceCode, offset) => sourceCode.getLocFromIndex(offset).line;

/** Whether a node spans more than one line. */
const isMultiline = (sourceCode, node) => lineAt(sourceCode, node.range[0]) !== lineAt(sourceCode, node.range[1]);

/**
 * The offset right after `node` plus any comments on its last line, and the offset of the first comment or code after
 * that: a blank line must sit between the two.
 */
const gapAfter = (sourceCode, node, nextStart) => {
  let end = node.range[1];

  const between = sourceCode.getAllComments().filter((c) => c.range[0] >= end && c.range[1] <= nextStart);
  const trailing = between.filter((c) => lineAt(sourceCode, c.range[0]) === lineAt(sourceCode, end));

  end = trailing.at(-1)?.range[1] ?? end;

  const following = between.find((c) => c.range[0] >= end);

  return { end, start: following?.range[0] ?? nextStart };
};

/** Requires a blank line between `previous` and `next`, with a fix that adds one. */
const requireBlankLine = (context, [previous, next], message) => {
  const { sourceCode } = context;
  const { end, start } = gapAfter(sourceCode, previous, next.range[0]);

  if (lineAt(sourceCode, start) - lineAt(sourceCode, end) < 2) {
    context.report({ node: next, message, fix: (fixer) => fixer.insertTextAfterRange([end, end], '\n') });
  }
};

/** The padding kind of a statement, as `padding-line-between-statements` names them. */
const paddingKind = (sourceCode, statement) => {
  if (statement.type === 'ImportDeclaration') {
    return 'import';
  }

  if (statement.type === 'FunctionDeclaration') {
    return 'padded';
  }

  const isExport = statement.type.startsWith('Export');
  const isConst = statement.type === 'VariableDeclaration' && statement.kind === 'const';

  return (isExport || isConst) && isMultiline(sourceCode, statement) ? 'padded' : 'other';
};

/** Checks one statement list for the blank lines of §I.4.2. */
const checkStatementList = (context, statements) => {
  statements.slice(1).forEach((next, index) => {
    const previous = statements[index];
    const previousKind = paddingKind(context.sourceCode, previous);
    const nextKind = paddingKind(context.sourceCode, next);

    if (previousKind === 'import' && nextKind !== 'import') {
      requireBlankLine(context, [previous, next], 'Expected a blank line after the imports.');
    } else if (previousKind === 'padded' || nextKind === 'padded') {
      requireBlankLine(context, [previous, next], 'Expected a blank line around a function or multi-line declaration.');
    }
  });
};

/**
 * A blank line after the imports and around every function declaration, multi-line export and multi-line `const`
 * (`padding-line-between-statements` in §I.4.2), autofixable.
 */
const paddedStatements = {
  meta: { type: 'layout', fixable: 'whitespace', schema: [] },

  create: (context) => ({
    Program: (node) => checkStatementList(context, node.body),
    BlockStatement: (node) => checkStatementList(context, node.body),
    StaticBlock: (node) => checkStatementList(context, node.body),
    SwitchCase: (node) => checkStatementList(context, node.consequent),
  }),
};

/** Whether an object-literal property is a function that spans several lines. */
const isMultilineFunction = (sourceCode, property) => {
  const value = property.type === 'Property' ? property.value : undefined;
  const isFunction = value?.type === 'ArrowFunctionExpression' || value?.type === 'FunctionExpression';

  return isFunction && isMultiline(sourceCode, property);
};

/** A blank line around every multi-line function in an object literal (§I.4.2), autofixable. */
const paddedObjectFunctions = {
  meta: { type: 'layout', fixable: 'whitespace', schema: [] },

  create: (context) => ({
    ObjectExpression: (node) => {
      node.properties.slice(1).forEach((next, index) => {
        const previous = node.properties[index];
        const { sourceCode } = context;

        if (isMultilineFunction(sourceCode, previous) || isMultilineFunction(sourceCode, next)) {
          const comma = sourceCode.getTokenAfter(previous);

          requireBlankLine(context, [comma, next], 'Expected a blank line around a multi-line function property.');
        }
      });
    },
  }),
};

/**
 * A blank line before every block comment on its own line, except at the start of a block, object, array or case, or
 * right after another comment (§I.4.2), autofixable.
 */
const blankLineBeforeBlockComment = {
  meta: { type: 'layout', fixable: 'whitespace', schema: [] },

  create: (context) => ({
    Program: () => {
      const { sourceCode } = context;
      const lines = sourceCode.lines;

      for (const comment of sourceCode.getAllComments()) {
        const line = lineAt(sourceCode, comment.range[0]);
        const lineStart = comment.range[0] - sourceCode.getLocFromIndex(comment.range[0]).column;
        const before = sourceCode.getTokenBefore(comment, { includeComments: true });
        const isAlone = sourceCode.text.slice(lineStart, comment.range[0]).trim() === '';
        const isAfterComment = before?.type === 'Line' || before?.type === 'Block';
        const isAtStart = before === null || isAfterComment || ['{', '[', ':'].includes(before.value);

        if (comment.type === 'Block' && isAlone && !isAtStart && line > 1 && lines[line - 2].trim() !== '') {
          context.report({
            loc: comment.loc,
            message: 'Expected a blank line before this block comment.',
            fix: (fixer) => fixer.insertTextAfterRange(before.range, '\n'),
          });
        }
      }
    },
  }),
};

/** The text of the `/** … *\/` block right before a node, or undefined when there is none. */
const docBlockOf = (sourceCode, node) => {
  const comment = sourceCode.getCommentsBefore(node).at(-1);

  if (comment?.type !== 'Block' || !comment.value.startsWith('*')) {
    return undefined;
  }

  return comment.value
    .slice(1)
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, ''))
    .join(' ')
    .split(/(?:^|\s)@\w/)[0]
    .trim();
};

/** Reports a missing, empty or not-a-sentence doc block on `node`, naming it `label`. */
const checkDocBlock = (context, node, label) => {
  const description = docBlockOf(context.sourceCode, node);

  if (description === undefined || description === '') {
    context.report({ node, message: `${label} has no /** */ block describing it (§I.4.2).` });
  } else if (!/^[^a-z]/.test(description) || !/[.!?]$/.test(description)) {
    context.report({ node, message: `The doc block of ${label} is not written as full sentences (§I.4.2).` });
  }
};

/** Calls `visit` on every property and method signature under a type, however nested. */
const forEachMember = (node, visit) => {
  if (node === null || typeof node !== 'object') {
    return;
  }

  if (node.type === 'TSPropertySignature' || node.type === 'TSMethodSignature') {
    visit(node);
  }

  for (const [key, child] of Object.entries(node)) {
    if (key !== 'parent' && child !== null && typeof child === 'object') {
      (Array.isArray(child) ? child : [child]).forEach((item) => forEachMember(item, visit));
    }
  }
};

/** The name a top-level declaration introduces, or undefined. */
const declaredName = (declaration) => declaration.id?.name ?? declaration.declarations?.[0]?.id.name;

/** The body of a type declaration, or undefined for any other declaration. */
const typeBody = (declaration) =>
  declaration.type === 'TSInterfaceDeclaration' || declaration.type === 'TSTypeAliasDeclaration'
    ? (declaration.body ?? declaration.typeAnnotation)
    : undefined;

/**
 * Every exported declaration of a file, with the node its doc block sits on: `export const …` and the like, and the
 * statements that declare the names of local `export { a, b }` lists.
 */
const exportedDeclarations = (program) => {
  const names = new Set(
    program.body
      .filter((s) => s.type === 'ExportNamedDeclaration' && s.source === null)
      .flatMap((s) => s.specifiers.map((specifier) => specifier.local.name)),
  );

  return [
    ...program.body
      .filter((s) => s.type === 'ExportNamedDeclaration' && s.declaration !== null)
      .map((s) => ({ docNode: s, declaration: s.declaration })),
    ...program.body
      .filter((s) => !s.type.startsWith('Export') && names.has(declaredName(s)))
      .map((s) => ({ docNode: s, declaration: s })),
  ];
};

/**
 * Every exported function, constant, type and interface, and every field and hook of an exported type, has a `/** *\/`
 * block written as full sentences (§I.4.2).
 */
const exportDocs = {
  meta: { type: 'suggestion', schema: [] },

  create: (context) => ({
    Program: (program) => {
      for (const { docNode, declaration } of exportedDeclarations(program)) {
        const name = declaredName(declaration) ?? 'this export';

        checkDocBlock(context, docNode, name);
        forEachMember(typeBody(declaration), (member) =>
          checkDocBlock(context, member, `${name}.${context.sourceCode.getText(member.key)}`),
        );
      }
    },
  }),
};

/** Field names that would carry presentation, which the client owns (§I.5.3). */
const PRESENTATION_FIELDS = new Set([
  'anim',
  'color',
  'description',
  'icon',
  'label',
  'model',
  'name',
  'sound',
  'text',
  'vfx',
]);

/**
 * No exported type has a field named like presentation (§I.5.3), unless the rule's `allow` option lists it as
 * `TypeName.field` (a developer-facing string).
 */
const presentationFields = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allow: { type: 'array', items: { type: 'string' } } } }],
  },

  create: (context) => ({
    Program: (program) => {
      const allowed = new Set(context.options[0]?.allow ?? []);

      for (const { declaration } of exportedDeclarations(program)) {
        forEachMember(typeBody(declaration), (member) => {
          const field = context.sourceCode.getText(member.key).replaceAll(/['"]/g, '');
          const qualified = `${declaredName(declaration)}.${field}`;

          if (PRESENTATION_FIELDS.has(field.toLowerCase()) && !allowed.has(qualified)) {
            context.report({
              node: member,
              message: `${qualified} is a presentation field; the client owns it (§I.5.3).`,
            });
          }
        });
      }
    },
  }),
};

/** Reports `identifier` unless its name matches one of `formats`. */
const checkName = (context, identifier, { formats, what }) => {
  if (identifier?.type === 'Identifier' && !formats.some((format) => format.test(identifier.name))) {
    context.report({ node: identifier, message: `${what} \`${identifier.name}\` is not in the §I.4.2 naming style.` });
  }
};

/** Checks a property key: identifiers and strings that need no quotes are camelCase. */
const checkKey = (context, property) => {
  const { key } = property;

  if (property.computed || key.type === 'PrivateIdentifier') {
    return;
  }

  if (key.type === 'Identifier' || (key.type === 'Literal' && IDENTIFIER_NAME.test(String(key.value)))) {
    const name = key.type === 'Identifier' ? key.name : String(key.value);

    if (!CAMEL_CASE.test(name)) {
      context.report({ node: key, message: `Property \`${name}\` is not camelCase (§I.4.2).` });
    }
  }
};

/** Checks the identifiers a parameter binds (plain, defaulted or rest). */
const checkParam = (context, param) => {
  if (param.type === 'AssignmentPattern') {
    checkParam(context, param.left);
  } else if (param.type === 'RestElement') {
    checkParam(context, param.argument);
  } else {
    checkName(context, param, { formats: [CAMEL_CASE], what: 'Parameter' });
  }
};

/**
 * The syntactic part of `naming-convention` (§I.4.2): camelCase functions, variables, parameters and fields;
 * UPPER_CASE also for module-level constants; PascalCase types; camelCase or PascalCase default and namespace imports.
 */
const naming = {
  meta: { type: 'suggestion', schema: [] },

  create: (context) => {
    const checkFunction = (node) => {
      checkName(context, node.id, { formats: [CAMEL_CASE], what: 'Function' });
      node.params.forEach((param) => checkParam(context, param));
    };

    return {
      VariableDeclarator: (node) => {
        const declaration = node.parent;

        const isModuleConst =
          declaration.kind === 'const' &&
          (declaration.parent.type === 'Program' || declaration.parent.parent?.type === 'Program');

        checkName(context, node.id, {
          formats: isModuleConst ? [CAMEL_CASE, UPPER_CASE] : [CAMEL_CASE],
          what: 'Variable',
        });
      },

      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,

      ImportDefaultSpecifier: (node) =>
        checkName(context, node.local, { formats: [CAMEL_CASE, PASCAL_CASE], what: 'Import' }),

      ImportNamespaceSpecifier: (node) =>
        checkName(context, node.local, { formats: [CAMEL_CASE, PASCAL_CASE], what: 'Import' }),

      TSTypeAliasDeclaration: (node) => checkName(context, node.id, { formats: [PASCAL_CASE], what: 'Type' }),
      TSInterfaceDeclaration: (node) => checkName(context, node.id, { formats: [PASCAL_CASE], what: 'Interface' }),
      TSTypeParameter: (node) => checkName(context, node.name, { formats: [PASCAL_CASE], what: 'Type parameter' }),

      Property: (node) => {
        if (node.parent.type === 'ObjectExpression') {
          checkKey(context, node);
        }
      },

      TSPropertySignature: (node) => checkKey(context, node),
      TSMethodSignature: (node) => checkKey(context, node),
    };
  },
};

/** The `simple-import-sort` group of an import source: side effects, `node:`, packages, then relative paths. */
const importGroup = (node) => {
  if (node.specifiers.length === 0 && node.importKind !== 'type') {
    return 0;
  }

  const source = node.source.value;

  if (source.startsWith('node:')) {
    return 1;
  }

  return source.startsWith('.') ? 3 : 2;
};

/** Sort key parts for an import: group, then parent depth (deeper first), then the source. */
const compareImports = (a, b) => {
  const depth = (node) => (node.source.value.match(/\.\.\//g) ?? []).length;

  return importGroup(a) - importGroup(b) || depth(b) - depth(a) || compareNames(a.source.value, b.source.value);
};

/** The runs of consecutive import declarations in a program. */
const importChunks = (program) => {
  const chunks = [[]];

  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      chunks.at(-1).push(statement);
    } else if (chunks.at(-1).length > 0) {
      chunks.push([]);
    }
  }

  return chunks.filter((chunk) => chunk.length > 1);
};

/** The sorted text of an import chunk, one blank line between groups. */
const sortedImportText = (sourceCode, chunk) =>
  [...chunk]
    .sort(compareImports)
    .map((node, index, sorted) => {
      const text = sourceCode.getText(node);

      return index > 0 && importGroup(sorted[index - 1]) !== importGroup(node) ? `\n${text}` : text;
    })
    .join('\n');

/**
 * Imports grouped (side effects, `node:`, packages, relative) and sorted by source, as `simple-import-sort` does;
 * autofixable when no comment sits inside the block. Named specifiers are sorted by oxlint's own `sort-imports`.
 */
const importOrder = {
  meta: { type: 'layout', fixable: 'code', schema: [] },

  create: (context) => ({
    Program: (program) => {
      const { sourceCode } = context;

      for (const chunk of importChunks(program)) {
        const range = [chunk[0].range[0], chunk.at(-1).range[1]];
        const expected = sortedImportText(sourceCode, chunk);

        if (sourceCode.text.slice(range[0], range[1]) !== expected) {
          const hasComments = sourceCode
            .getCommentsInside?.(chunk[0].parent)
            ?.some((c) => c.range[0] > range[0] && c.range[1] < range[1]);

          context.report({
            node: chunk[0],
            message: 'Imports are grouped (side effects, node:, packages, relative) and sorted by source (§I.4.2).',
            fix: hasComments ? undefined : (fixer) => fixer.replaceTextRange(range, expected),
          });
        }
      }
    },
  }),
};

/** The specifiers of every `export { … }` list are sorted by name, as `simple-import-sort/exports` does. */
const exportOrder = {
  meta: { type: 'layout', schema: [] },

  create: (context) => ({
    ExportNamedDeclaration: (node) => {
      const names = node.specifiers.map((s) => context.sourceCode.getText(s.local));
      const sorted = [...names].sort(compareNames);

      if (names.some((name, index) => name !== sorted[index])) {
        context.report({ node, message: 'Exported names are sorted (§I.4.2).' });
      }
    },
  }),
};

export default {
  meta: { name: 'spellweave' },
  rules: {
    'todo-with-issue': todoWithIssue,
    'padded-statements': paddedStatements,
    'padded-object-functions': paddedObjectFunctions,
    'blank-line-before-block-comment': blankLineBeforeBlockComment,
    'export-docs': exportDocs,
    'presentation-fields': presentationFields,
    naming,
    'import-order': importOrder,
    'export-order': exportOrder,
  },
};
