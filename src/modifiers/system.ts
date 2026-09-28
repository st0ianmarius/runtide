import { buildSheet } from './build-sheet.ts';
import { compileModifiers } from './compile-modifiers.ts';
import type { StatView } from './compiled.ts';
import type { ConditionTable } from './conditions.ts';
import { explainSheetStat, type StatExplanation } from './explain.ts';
import { foldStat, scopedProduct } from './fold.ts';
import type { Modifier, ModifierList } from './modifier.ts';
import { type FoldRead, type FoldTables, Sheet, sheetOf, type StatSheet } from './sheet.ts';
import type { SourceId, SourceTable } from './sources.ts';
import type { StatId } from './stat-id.ts';
import type { StatTable } from './stats.ts';
import type { ValueTable } from './values.ts';

/** What a modifier system is built from: the game's tables and its host's stack report. */
export interface ModifierSystemOptions<Host, S extends string, C extends string, V extends string, Src extends string> {
  /** The game's stat table. */
  readonly stats: StatTable<S>;

  /** The game's modifier sources, in fold order. */
  readonly sources: SourceTable<Src>;

  /** The game's condition tests, if modifiers wait on conditions. */
  readonly conditions?: ConditionTable<C, Host>;

  /** The game's value kinds, if modifier values read the bearer. */
  readonly values?: ValueTable<V, Host>;

  /** How many stacks of a gate (an aura id) the host has; gated lists count only while it reports more than 0. */
  readonly stacks?: (host: Host, gate: number) => number;
}

/**
 * A modifier system (§I.6): the fold over one game's tables. Every bearer (hero, creature, summon: §II.6 M9) has a
 * stat sheet whose compiled lists are cached and rebuilt only when a source changes; conditions, gates and game
 * values are evaluated on every read, never cached, since what they read changes without the sheet knowing (§I.5.4).
 */
export interface ModifierSystem<Host, S extends string, C extends string, V extends string, Src extends string> {
  /** The game's stat table. */
  readonly stats: StatTable<S>;

  /** The game's modifier sources. */
  readonly sources: SourceTable<Src>;

  /** Compiles and checks a modifier list against the system's tables (at load); `gate` makes it an aura's list. */
  readonly compile: (
    modifiers: readonly Modifier<NoInfer<S>, NoInfer<C>, NoInfer<V>>[],
    options?: {
      /** The gate the list waits on (an aura id). */
      readonly gate?: number;

      /** What is being compiled, for error messages. */
      readonly what?: string;
    },
  ) => ModifierList;

  /** A new, empty stat sheet for one bearer. */
  readonly createSheet: () => StatSheet;

  /** Replaces the lists a sheet holds at one source (its gear, its talents), marking the sheet dirty. */
  readonly setSource: (sheet: StatSheet, source: SourceId, lists: readonly ModifierList[]) => void;

  /**
   * Replaces the lists every sheet folds at one source after its own lists there: the aura registry's gated lists at
   * their chosen fold position, compiled into every sheet once so that an aura coming or going recompiles nothing.
   */
  readonly share: (source: SourceId, lists: readonly ModifierList[]) => void;

  /**
   * Folds one stat of a sheet (§I.5): `clamp(min((base + Σ add + derived) × Π mul, …caps))`, multipliers one by one
   * in source order, caps in turn after every multiplier, the stat's clamp last. Allocates nothing once built.
   */
  readonly resolve: (sheet: StatSheet, stat: StatId, read?: FoldRead<Host>) => number;

  /** The product of a stat's live scoped multipliers for a read, in source order (§II.6 M5). */
  readonly scopedProduct: (sheet: StatSheet, stat: StatId, read?: FoldRead<Host>) => number;

  /** A stat view of a sheet for one read, for scaled values and curves (§II.3.13). Make it once and keep it. */
  readonly view: (sheet: StatSheet, read?: FoldRead<Host>) => StatView;

  /** A stat's fold explained step by step as data (§I.5.3); its total is the float `resolve` returns. */
  readonly explainStat: (sheet: StatSheet, stat: StatId, read?: FoldRead<Host>) => StatExplanation;
}

/** Throws unless a source id belongs to the table. */
const checkSource = (sources: SourceTable, source: SourceId): void => {
  if (!Number.isInteger(source) || source < 0 || source >= sources.size) {
    throw new RangeError(`${source} is not a modifier source of this game.`);
  }
};

/** The fold tables of a system. */
const tablesOf = <Host, S extends string, C extends string, V extends string, Src extends string>(
  options: ModifierSystemOptions<Host, S, C, V, Src>,
): FoldTables<Host> => {
  const { stats } = options;
  const column = (name: 'base' | 'min' | 'max'): Float64Array => Float64Array.from(stats.columns[name]);

  return {
    base: column('base'),
    min: column('min'),
    max: column('max'),
    derivations: stats.derivations,
    stacks: options.stacks,
    tests: options.conditions?.defs.map((def) => def?.test ?? (() => false)) ?? [],
    reads: options.values?.defs.map((def) => def?.read ?? (() => 0)) ?? [],
    sourceIds: options.sources.ids,
    nameOf: (stat) => stats.names[stat] ?? String(stat),
  };
};

// Each read sets the sheet's current read and restores the previous one, so a nested read (a condition asking for
// another stat) sees its own. They are written out one by one so that a read creates no closure.

/** Folds a built sheet's stat for a read. */
const foldFor = <Host>(sheet: Sheet<Host>, stat: StatId, read: FoldRead<Host> | undefined): number => {
  const previous = sheet.view.read;

  sheet.view.read = read;

  const value = foldStat(sheet, stat);

  sheet.view.read = previous;

  return value;
};

/** The scoped product of a built sheet's stat for a read. */
const productFor = <Host>(sheet: Sheet<Host>, stat: StatId, read: FoldRead<Host> | undefined): number => {
  const previous = sheet.view.read;

  sheet.view.read = read;

  const value = scopedProduct(sheet, stat);

  sheet.view.read = previous;

  return value;
};

/** Explains a built sheet's stat for a read. */
const explainFor = <Host>(sheet: Sheet<Host>, stat: StatId, read: FoldRead<Host> | undefined): StatExplanation => {
  const previous = sheet.view.read;

  sheet.view.read = read;

  const explanation = explainSheetStat(sheet, stat);

  sheet.view.read = previous;

  return explanation;
};

/** Throws unless every list may be held: a gated list needs a stacks report. Returns a frozen copy. */
const checkedLists = (
  sources: SourceTable,
  at: { readonly source: SourceId; readonly hasStacks: boolean },
  lists: readonly ModifierList[],
): readonly ModifierList[] => {
  checkSource(sources, at.source);

  if (!at.hasStacks && lists.some((list) => list.gate !== undefined)) {
    throw new RangeError('A gated modifier list needs the system to have a stacks report.');
  }

  return Object.freeze([...lists]);
};

/** Creates the modifier system over a game's tables (§I.5: `defineStats`, `defineSources`, `defineConditions`). */
export const createModifierSystem = <
  Host,
  S extends string,
  Src extends string,
  C extends string = never,
  V extends string = never,
>(
  options: ModifierSystemOptions<Host, S, C, V, Src>,
): ModifierSystem<Host, S, C, V, Src> => {
  const tables = tablesOf(options);
  const shared: (readonly ModifierList[])[] = options.sources.ids.map(() => []);
  let revision = 0;

  const built = (sheet: StatSheet): Sheet<Host> => {
    const own = sheetOf<Host>(sheet);

    if (own.isDirty || own.sharedRevision !== revision) {
      buildSheet(own, shared);
      own.sharedRevision = revision;
    }

    return own;
  };

  const hasStacks = options.stacks !== undefined;

  return {
    stats: options.stats,
    sources: options.sources,
    compile: (modifiers, compileOptions = {}) => compileModifiers(options, modifiers, compileOptions),
    createSheet: () => new Sheet<Host>(tables, foldStat),

    setSource: (sheet, source, lists) => {
      const own = sheetOf<Host>(sheet);

      own.lists[source] = checkedLists(options.sources, { source, hasStacks }, lists);
      own.isDirty = true;
    },

    share: (source, lists) => {
      shared[source] = checkedLists(options.sources, { source, hasStacks }, lists);
      revision += 1;
    },

    resolve: (sheet, stat, read) => foldFor(built(sheet), stat, read),
    scopedProduct: (sheet, stat, read) => productFor(built(sheet), stat, read),
    explainStat: (sheet, stat, read) => explainFor(built(sheet), stat, read),

    view: (sheet, read) => ({
      total: (stat) => foldFor(built(sheet), stat, read),
      base: (stat) => tables.base[stat] ?? 0,
    }),
  };
};
