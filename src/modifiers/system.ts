import {
  type BoundTables,
  type BoundTest,
  type CompiledCondition,
  type ConditionTable,
  conditionTest,
  type ValueTable,
} from '../conditions/index.ts';
import { SheetCaches } from './build-sheet.ts';
import { compileModifiers } from './compile-modifiers.ts';
import type { StatView } from './compiled.ts';
import { explainSheetStat, type StatExplanation } from './explain.ts';
import { foldStat, scopedProduct } from './fold.ts';
import type { Modifier, ModifierList } from './modifier.ts';
import { compileShared, SharedLists } from './shared.ts';
import { type FoldRead, type FoldTables, type HeldGate, Sheet, sheetOf, type StatSheet } from './sheet.ts';
import type { SourceId, SourceTable } from './sources.ts';
import type { StatId } from './stat-id.ts';
import type { StatTable } from './stats.ts';

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

  /**
   * The gates the host holds, in ascending gate order, repeats allowed (`auraGates`: its aura instances). With it a
   * read walks the shared lists of those gates only, so its cost follows what the host holds rather than every gated
   * list the game defines; without it a read asks `stacks` for every shared gate. It must list every gate `stacks`
   * reports above 0.
   */
  readonly held?: (host: Host) => readonly HeldGate[];
}

/**
 * A modifier system: the fold over one game's tables. Every bearer (hero, creature, summon:) has a
 * stat sheet whose compiled lists are cached and rebuilt only when a source changes; conditions, gates and game
 * values are evaluated on every read, never cached, since what they read changes without the sheet knowing.
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
   * their chosen fold position, in ascending gate order. They are compiled once for the system and never copied into
   * a sheet (a sheet points at a stat's few shared entries, or holds one marker where there are many), so an aura
   * coming or going recompiles nothing and neither a sheet's size nor a read's cost grows with the registry.
   */
  readonly share: (source: SourceId, lists: readonly ModifierList[]) => void;

  /**
   * Folds one stat of a sheet: `clamp(min((base + Σ add + derived) × Π mul, …caps))`, multipliers one by one
   * in source order, caps in turn after every multiplier, the stat's clamp last. Allocates nothing once built.
   */
  readonly resolve: (sheet: StatSheet, stat: StatId, read?: FoldRead<Host>) => number;

  /** The product of a stat's live scoped multipliers for a read, in source order. */
  readonly scopedProduct: (sheet: StatSheet, stat: StatId, read?: FoldRead<Host>) => number;

  /** A stat view of a sheet for one read, for scaled values and curves. Make it once and keep it. */
  readonly view: (sheet: StatSheet, read?: FoldRead<Host>) => StatView;

  /** A stat's fold explained step by step as data; its total is the float `resolve` returns. */
  readonly explainStat: (sheet: StatSheet, stat: StatId, read?: FoldRead<Host>) => StatExplanation;
}

/** Throws unless a source id belongs to the table. */
const checkSource = (sources: SourceTable, source: SourceId): void => {
  if (!Number.isInteger(source) || source < 0 || source >= sources.size) {
    throw new RangeError(`${source} is not a modifier source of this game.`);
  }
};

/** A condition binder that binds each compiled condition once and hands back the same test after. */
const boundTests = <Host>(tables: BoundTables<Host>) => {
  const bound = new WeakMap<CompiledCondition, BoundTest<Host>>();

  return (condition: CompiledCondition): BoundTest<Host> => {
    const known = bound.get(condition);

    if (known !== undefined) {
      return known;
    }

    const made = conditionTest(tables, condition);

    bound.set(condition, made);

    return made;
  };
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
    held: options.held,
    shared: new SharedLists<Host>(),
    testOf: boundTests({ conditions: options.conditions, values: options.values }),
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

  for (const list of lists) {
    if (!at.hasStacks && list.gate !== undefined) {
      throw new RangeError('A gated modifier list needs the system to have a stacks report.');
    }
  }

  return Object.freeze(lists.slice());
};

/** Creates the modifier system over a game's tables (`defineStats`, `defineSources`, `defineConditions`). */
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
  const caches = new SheetCaches<Host>();

  const built = (sheet: StatSheet): Sheet<Host> => {
    const own = sheetOf<Host>(sheet);

    if (own.isDirty || own.sharedRevision !== tables.shared.revision) {
      caches.build(own, tables.shared.revision);
      own.sharedRevision = tables.shared.revision;
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
      compileShared(tables, shared, tables.shared);
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
