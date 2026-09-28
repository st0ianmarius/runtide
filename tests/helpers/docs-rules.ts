import ts from 'typescript';

import { type Finding, findingAt, walk } from './source-scan.ts';

/**
 * Field names that would carry presentation (§I.5.3). The client owns every name, text, icon, colour, sound, effect,
 * model and animation, keyed by numeric ids, so no exported type of the framework has a field named like one.
 */
const PRESENTATION_FIELDS: ReadonlySet<string> = new Set([
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

/** Whether the comment right before a node is a `/** … *\/` block with some text in it. */
const hasDocBlock = (node: ts.Node): boolean => {
  const source = node.getSourceFile();
  const start = node.getFullStart();

  // A comment on the same line as the previous token counts as that token's trailing comment, so both kinds are read.
  const comments = [
    ...(ts.getTrailingCommentRanges(source.text, start) ?? []),
    ...(ts.getLeadingCommentRanges(source.text, start) ?? []),
  ];

  const last = comments.at(-1);

  if (last === undefined) {
    return false;
  }

  const comment = source.text.slice(last.pos, last.end);
  const body = comment.slice('/**'.length, -'*/'.length).replace(/[\s*]/g, '');

  return comment.startsWith('/**') && body.length > 0;
};

/** Whether a top-level statement carries the `export` modifier. */
const hasExportModifier = (statement: ts.Statement): boolean =>
  ts.canHaveModifiers(statement) &&
  (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** The names a file exports through local `export { a, b as c }` lists. */
const locallyExportedNames = (source: ts.SourceFile): ReadonlySet<string> => {
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) {
      continue;
    }

    if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
  }

  return names;
};

/** A top-level declaration that carries its own name. */
type NamedStatement =
  | ts.ClassDeclaration
  | ts.EnumDeclaration
  | ts.FunctionDeclaration
  | ts.InterfaceDeclaration
  | ts.ModuleDeclaration
  | ts.TypeAliasDeclaration;

/** Whether a top-level statement is a declaration that carries its own name. */
const isNamedStatement = (statement: ts.Statement): statement is NamedStatement =>
  ts.isClassDeclaration(statement) ||
  ts.isEnumDeclaration(statement) ||
  ts.isFunctionDeclaration(statement) ||
  ts.isInterfaceDeclaration(statement) ||
  ts.isModuleDeclaration(statement) ||
  ts.isTypeAliasDeclaration(statement);

/** The names a top-level statement declares. */
const declaredNames = (statement: ts.Statement): readonly string[] => {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  }

  const name = isNamedStatement(statement) ? statement.name : undefined;

  return name !== undefined && ts.isIdentifier(name) ? [name.text] : [];
};

/** The top-level declarations a file exports, by modifier or through a local export list. */
const exportedStatements = (source: ts.SourceFile): readonly ts.Statement[] => {
  const listed = locallyExportedNames(source);

  return source.statements.filter(
    (statement) =>
      !ts.isExportDeclaration(statement) &&
      (hasExportModifier(statement) || declaredNames(statement).some((name) => listed.has(name))),
  );
};

/** The text of a field's name, when it is an identifier or a string literal. */
const fieldName = (member: ts.PropertySignature | ts.MethodSignature): string | undefined =>
  ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name) ? member.name.text : undefined;

/** Every field and method signature inside an exported interface or type alias, however deeply nested. */
const fieldsOf = (declaration: ts.Statement): readonly (ts.PropertySignature | ts.MethodSignature)[] => {
  const fields: (ts.PropertySignature | ts.MethodSignature)[] = [];

  walk(declaration, (node) => {
    if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
      fields.push(node);
    }
  });

  return fields;
};

/** The name an exported type is known by in the allowlist, such as `SpellDef`. */
const typeName = (declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): string => declaration.name.text;

/** Every field and method of an exported interface or type alias that has no doc block. */
const missingFieldDocs = (statement: ts.Statement): Finding[] => {
  if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
    return [];
  }

  return fieldsOf(statement)
    .filter((field) => !hasDocBlock(field))
    .map((field) => findingAt(field, `${typeName(statement)}.${fieldName(field) ?? '?'} has no doc block`));
};

/**
 * Every exported declaration of a file (function, constant, type, interface) and every field and method of an exported
 * type that has no `/** *\/` block right before it.
 */
export const findMissingDocs = (source: ts.SourceFile): Finding[] =>
  exportedStatements(source).flatMap((statement) => [
    ...(hasDocBlock(statement)
      ? []
      : [findingAt(statement, `exports ${declaredNames(statement).join(', ')} without a doc block`)]),
    ...missingFieldDocs(statement),
  ]);

/**
 * Every field of an exported type whose name belongs to presentation (`name`, `label`, `text`, `description`, `icon`,
 * `color`, `sound`, `vfx`, `model`, `anim`), unless the allowlist names it as `TypeName.field`.
 */
export const findPresentationFields = (source: ts.SourceFile, allowed: ReadonlySet<string>): Finding[] => {
  const findings: Finding[] = [];

  for (const statement of exportedStatements(source)) {
    if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
      continue;
    }

    for (const field of fieldsOf(statement)) {
      const name = fieldName(field);
      const key = `${typeName(statement)}.${name ?? '?'}`;

      if (name !== undefined && PRESENTATION_FIELDS.has(name.toLowerCase()) && !allowed.has(key)) {
        findings.push(findingAt(field, `${key} is a presentation field`));
      }
    }
  }

  return findings;
};
