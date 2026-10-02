import { entryOf, gathering, type Gathering, listFor } from './build-sheet.ts';
import type { CompiledModifier, ModifierList } from './modifier.ts';
import { type Entry, type FoldTables, FROM_STAT, type Sheet } from './sheet.ts';
import type { SourceId } from './sources.ts';
import type { StatId } from './stat-id.ts';

/**
 * Up to this many gates, a stat's shared entries at a source go into each sheet's lists as they are, checked one by
 * one like the sheet's own (as fast as the fold gets for a game with few auras); past it, a sheet holds their marker and
 * a read walks the host's held gates instead, so it never grows with the number the game defines.
 */
export const INLINE_GATES = 4;

/** The modifier a marker entry carries: it lands nothing and is never explained (explanations expand markers). */
const markerOf = (stat: StatId): CompiledModifier =>
  Object.freeze({
    stat,
    op: 'add',
    value: 0,
    stacking: 'power',
    perStack: undefined,
    when: undefined,
    scope: undefined
  });

/**
 * The entries of one stat that the shared lists fold at one source, by gate: compiled once for the system,
 * so that a read walks the gates its host holds and looks each one up here, whatever the number of gates the game
 * defines. A sheet's compiled lists hold its `marker` where these entries fold, so the fold's flat loop over a
 * sheet's list keeps the fold order and turns aside here only for the stats and lists that have shared entries.
 */
export class SharedAt<Host> {
  /** The stat. */
  readonly stat: StatId;

  /** The source the entries fold at. */
  readonly source: SourceId;

  /** The gates with entries here, in ascending order. */
  readonly gates: number[] = [];

  /** Each gate's index in `gates`, by gate id; -1 or past the end for a gate with none. */
  slots: Int32Array = new Int32Array(0);

  /** Each gate's entries, by index in `gates`, as the stat's adds, muls and mins, in authored order. */
  readonly entries: Gathering<Host>[] = [];

  /** Which lists have entries here, in first-seen order: the lists of each sheet that hold them or the marker. */
  readonly ops: CompiledModifier['op'][] = [];

  /** The entry a sheet's lists hold in place of these entries (its `shared` is this). */
  readonly marker: Entry<Host>;

  constructor(tables: FoldTables<Host>, at: { readonly stat: StatId; readonly source: SourceId }) {
    this.stat = at.stat;
    this.source = at.source;
    this.marker = entryOf(tables, markerOf(at.stat), { source: at.source, gate: -1, shared: this });
  }

  /** The entries of a gate, gathered in order; made on the gate's first entry. */
  gather(gate: number): Gathering<Host> {
    if (this.gates.at(-1) !== gate) {
      this.gates.push(gate);
      this.entries.push(gathering<Host>());
    }

    return this.entries.at(-1) ?? gathering<Host>();
  }

  /** Fills `slots` from `gates`, once every entry is in. */
  index(): void {
    this.slots = new Int32Array((this.gates.at(-1) ?? -1) + 1).fill(-1);
    this.gates.forEach((gate, index) => {
      this.slots[gate] = index;
    });
  }
}

/** The lists every sheet folds (`share`), compiled once for the system, and what they make each stat follow. */
export class SharedLists<Host> {
  /** The shared entries at each source, one per stat that has some there, by source id. */
  bySource: readonly (readonly SharedAt<Host>[] | undefined)[] = [];

  /** The stats each stat's shared entries follow (stat-valued modifiers), for the cycle check. */
  follows: readonly (readonly number[] | undefined)[] = [];

  /** Rises on every `share`, so sheets rebuild their lists (their markers) and recheck their cycles. */
  revision = 0;
}

/** Throws unless a source's shared lists are gated, in ascending gate order (so a held walk keeps their fold order). */
const checkGates = (lists: readonly ModifierList[]): void => {
  let last = -1;

  for (const list of lists) {
    if (list.gate === undefined || list.gate < last) {
      throw new RangeError('The lists every sheet shares are gated, in ascending gate order (an aura registry’s).');
    }

    last = list.gate;
  }
};

/** Compiles one source's shared lists into its entries by stat, and each stat's follows into `follows`. */
const compileSource = <Host>(
  tables: FoldTables<Host>,
  at: { readonly source: SourceId; readonly lists: readonly ModifierList[] },
  follows: number[][]
): readonly SharedAt<Host>[] | undefined => {
  const byStat = new Map<StatId, SharedAt<Host>>();
  const { source } = at;

  checkGates(at.lists);

  for (const list of at.lists) {
    for (const modifier of list.modifiers) {
      const { stat, op } = modifier;
      const into = byStat.get(stat) ?? new SharedAt<Host>(tables, { stat, source });
      const entry = entryOf(tables, modifier, { source, gate: list.gate ?? -1 });

      byStat.set(stat, into);
      listFor(into.gather(entry.gate), op).push(entry);
      if (!into.ops.includes(op)) {
        into.ops.push(op);
      }

      if (entry.valueKind === FROM_STAT) {
        follows[stat]?.push(entry.valueStat);
      }
    }
  }

  const ats = [...byStat.values()];

  for (const shared of ats) {
    shared.index();
  }

  return ats.length === 0 ? undefined : ats;
};

/** Compiles the shared lists of every source into `into`. */
export const compileShared = <Host>(
  tables: FoldTables<Host>,
  bySource: readonly (readonly ModifierList[])[],
  into: SharedLists<Host>
): void => {
  const follows: number[][] = Array.from(tables.base, () => []);

  const compiled: (readonly SharedAt<Host>[] | undefined)[] = [];

  for (const source of tables.sourceIds) {
    compiled[source] = compileSource(tables, { source, lists: bySource[source] ?? [] }, follows);
  }

  into.bySource = compiled;
  into.follows = follows.map((stats) => (stats.length === 0 ? undefined : stats));
  into.revision += 1;
};

/**
 * Every entry of one list of a stat in fold order, each marker expanded into every gate's shared entries in gate
 * order. It allocates, for explanations; the fold walks the same order in place.
 */
export const entriesInOrder = <Host>(
  sheet: Sheet<Host>,
  stat: number,
  list: keyof Gathering<Host>
): readonly Entry<Host>[] =>
  (sheet.compiled[stat]?.[list] ?? []).flatMap((entry) =>
    entry.shared === undefined ? [entry] : entry.shared.entries.flatMap((gathered) => gathered[list])
  );
