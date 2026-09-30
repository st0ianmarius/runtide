import type { CompiledModifier, CompiledValue, ModifierList } from './modifier.ts';
import { INLINE_GATES, type SharedAt } from './shared.ts';
import { type CompiledStat, type Entry, type FoldTables, FROM_HOST, FROM_STAT, PLAIN, type Sheet } from './sheet.ts';
import type { SourceId } from './sources.ts';

/** The value fields of an entry. */
interface ValueFields {
  readonly value: number;
  readonly valueKind: number;
  readonly valueStat: number;
  readonly per: number;
  readonly neutral: number;
  readonly cap: number;
  readonly readId: number;
  readonly readArg: number;
}

/** The value fields of a compiled value: a plain number, a followed stat, or a game value read. */
const valueFields = (value: CompiledValue): ValueFields => {
  const plain = {
    value: 0,
    valueKind: PLAIN,
    valueStat: -1,
    per: 0,
    neutral: 0,
    cap: Infinity,
    readId: -1,
    readArg: 0
  };

  if (typeof value === 'number') {
    return { ...plain, value };
  }

  if (value.kind === 'stat') {
    const { stat, per, neutral } = value;

    return {
      ...plain,
      valueKind: FROM_STAT,
      valueStat: stat,
      per,
      neutral,
      cap: value.cap ?? Infinity
    };
  }

  return { ...plain, valueKind: FROM_HOST, readId: value.value, readArg: value.arg };
};

/** The fold entry of one compiled modifier from one source, every field present (one hidden class). */
export const entryOf = <Host>(
  tables: FoldTables<Host>,
  modifier: CompiledModifier,
  at: { readonly source: SourceId; readonly gate: number; readonly shared?: SharedAt<Host> }
): Entry<Host> => {
  const fields = valueFields(modifier.value);
  const { when } = modifier;
  const bound = when === undefined ? undefined : tables.testOf(when);

  return {
    value: fields.value,
    valueKind: fields.valueKind,
    valueStat: fields.valueStat,
    per: fields.per,
    neutral: fields.neutral,
    cap: fields.cap,
    read: fields.readId < 0 ? undefined : tables.reads[fields.readId],
    readArg: fields.readArg,
    test: bound?.test,
    testArg: bound?.arg ?? 0,
    scope: modifier.scope ?? -1,
    source: at.source,
    gate: at.gate,
    isLinear: modifier.stacking === 'linear',
    modifier,
    shared: at.shared
  };
};

/** A stat's lists while they are gathered. */
export interface Gathering<Host> {
  /** The additions. */
  readonly adds: Entry<Host>[];

  /** The multipliers. */
  readonly muls: Entry<Host>[];

  /** The caps. */
  readonly mins: Entry<Host>[];
}

/** Empty lists for one stat. */
export const gathering = <Host>(): Gathering<Host> => ({ adds: [], muls: [], mins: [] });

/** The list of a stat an op goes into. */
export const listFor = <Host>(into: Gathering<Host>, op: CompiledModifier['op']): Entry<Host>[] => {
  if (op === 'add') {
    return into.adds;
  }

  return op === 'mul' ? into.muls : into.mins;
};

/** Throws when stat-valued modifiers and derived terms make a stat follow itself. */
const checkAcyclic = <Host>(sheet: Sheet<Host>, lists: readonly Gathering<Host>[]): void => {
  const follows = (stat: number): number[] => [
    ...(sheet.tables.derivations[stat] ?? []).flatMap((derivation) =>
      derivation.kind === 'converts' ? [derivation.from, ...derivation.reads] : [derivation.from]
    ),
    ...[...(lists[stat]?.adds ?? []), ...(lists[stat]?.muls ?? []), ...(lists[stat]?.mins ?? [])]
      .filter((entry) => entry.valueKind === FROM_STAT)
      .map((entry) => entry.valueStat),
    ...(sheet.tables.shared.follows[stat] ?? [])
  ];

  const state = new Uint8Array(sheet.tables.base.length);

  const visit = (stat: number): void => {
    if (state[stat] === 1) {
      throw new RangeError(`Stat ${sheet.tables.nameOf(stat)} follows itself through stat-valued modifiers.`);
    }

    if (state[stat] === 0) {
      state[stat] = 1;
      for (const next of follows(stat)) {
        visit(next);
      }

      state[stat] = 2;
    }
  };

  for (const stat of lists.keys()) {
    visit(stat);
  }
};

/**
 * A stat's shared entries at one source into a sheet's lists: the entries themselves (shared objects, not copies)
 * while they have few gates, which the fold checks one by one as fast as its own; else one marker per list, where the
 * fold walks the gates the host holds, so a read never grows with the number of gates the game defines.
 */
const addShared = <Host>(into: Gathering<Host>, shared: SharedAt<Host>): void => {
  for (const op of shared.ops) {
    const list = listFor(into, op);

    if (shared.gates.length > INLINE_GATES) {
      list.push(shared.marker);
    } else {
      for (const gathered of shared.entries) {
        list.push(...listFor(gathered, op));
      }
    }
  }
};

/**
 * Rebuilds a sheet's compiled cache: every stat's adds, muls and mins, source by source in fold order, the sheet's own
 * lists in authored order and then, where the lists every sheet shares have entries for the stat, those entries or
 * their marker (`addShared`). Shared entries are compiled once for the system (`SharedLists`), never per sheet; the
 * check for stats following themselves reads both.
 */
const buildSheet = <Host>(sheet: Sheet<Host>): void => {
  const lists = Array.from(sheet.tables.base, () => gathering<Host>());

  for (const source of sheet.tables.sourceIds) {
    for (const list of sheet.lists[source] ?? []) {
      for (const modifier of list.modifiers) {
        const into = lists[modifier.stat] ?? gathering<Host>();

        listFor(into, modifier.op).push(entryOf(sheet.tables, modifier, { source, gate: list.gate ?? -1 }));
      }
    }

    for (const shared of sheet.tables.shared.bySource[source] ?? []) {
      addShared(lists[shared.stat] ?? gathering<Host>(), shared);
    }
  }

  checkAcyclic(sheet, lists);

  sheet.compiled = lists.map((stat): CompiledStat<Host> | undefined =>
    stat.adds.length + stat.muls.length + stat.mins.length === 0 ? undefined : Object.freeze(stat)
  );

  sheet.isDirty = false;
  sheet.compiles += 1;
};

/** A compiled cache and what it was built from: the lists at every source, and the shared lists' revision. */
interface CacheEntry<Host> {
  readonly lists: readonly (readonly ModifierList[])[];
  readonly revision: number;
  readonly compiled: readonly (CompiledStat<Host> | undefined)[];
}

/** How many caches one first list keeps before it forgets the oldest. */
const CACHE_WAYS = 8;

/** Whether two sheets hold the same lists at every source (the same compiled lists, by identity). */
const isSameLists = (a: readonly (readonly ModifierList[])[], b: readonly (readonly ModifierList[])[]): boolean =>
  a.length === b.length &&
  a.every((lists, source) => {
    const other = b[source] ?? [];

    return lists.length === other.length && lists.every((list, index) => list === other[index]);
  });

/**
 * The compiled caches of a system's sheets by the lists they hold: sheets holding the same compiled lists (a
 * template's units, each given its template's base list) share one cache, built by the first. Keyed weakly by the
 * first list a sheet holds, so a list no sheet holds any more takes its caches with it.
 */
export class SheetCaches<Host> {
  readonly #byFirst = new WeakMap<ModifierList, CacheEntry<Host>[]>();
  readonly #listless: CacheEntry<Host>[] = [];

  /** The caches of sheets whose first list is this sheet's. */
  #entriesOf(sheet: Sheet<Host>): CacheEntry<Host>[] {
    const first = sheet.lists.find((lists) => lists.length > 0)?.[0];

    if (first === undefined) {
      return this.#listless;
    }

    const entries = this.#byFirst.get(first) ?? [];

    this.#byFirst.set(first, entries);

    return entries;
  }

  /** Gives a sheet a compiled cache for its lists: one another sheet built, else a new one it keeps for the next. */
  build(sheet: Sheet<Host>, revision: number): void {
    const entries = this.#entriesOf(sheet);

    const known = entries.find((entry) => entry.revision === revision && isSameLists(entry.lists, sheet.lists));

    if (known !== undefined) {
      sheet.compiled = known.compiled;
      sheet.isDirty = false;
      sheet.compiles += 1;

      return;
    }

    buildSheet(sheet);
    entries.push({ lists: sheet.lists.slice(), revision, compiled: sheet.compiled });

    if (entries.length > CACHE_WAYS) {
      entries.shift();
    }
  }
}
