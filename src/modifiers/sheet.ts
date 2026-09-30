import type { BoundTest, CompiledCondition, ConditionTest, ValueRead } from '../conditions/index.ts';
import type { Bitset } from '../core/index.ts';
import type { ScaledContext, StatView } from './compiled.ts';
import type { CompiledModifier, ModifierList } from './modifier.ts';
import type { SharedAt, SharedLists } from './shared.ts';
import type { SourceId } from './sources.ts';
import type { StatId } from './stat-id.ts';
import type { Derivation } from './stats.ts';

/**
 * How one read folds a stat. Games keep one read object per purpose and reuse it, so a read allocates
 * nothing.
 */
export interface FoldRead<Host> {
  /**
   * What conditions, value kinds and gates read; without one, every conditional, host-valued or gated modifier is
   * skipped.
   */
  readonly host?: Host | undefined;

  /** The scope ids the read reaches (a spell's id and tags); without one, every scoped modifier is skipped. */
  readonly scope?: Bitset | undefined;

  /** The mask of the sources folded (`sourceMask`); every source when absent. */
  readonly sources?: number | undefined;

  /** `skip` leaves out the scoped multipliers (not the scoped adds or caps), for a caller that places them itself. */
  readonly scopedMuls?: 'fold' | 'skip' | undefined;

  /** A what-if: the gate reads this many stacks instead of the host's (+1 stack, or 0 for "without it"). */
  readonly whatIf?:
    | {
        /** The gate overridden (an aura id). */
        readonly gate: number;

        /** The stacks it reads. */
        readonly stacks: number;
      }
    | undefined;
}

/** A bearer's stat sheet: its modifier lists per source and their compiled cache. */
export interface StatSheet {
  /** Whether the compiled cache waits for a rebuild (a source changed since the last read). */
  readonly isDirty: boolean;

  /** How many times it took a compiled cache (built, or shared by a sheet holding the same lists), for diagnostics. */
  readonly compiles: number;
}

/** The value kind of an entry: a plain number, another stat's bonus, or a game value read. */
export const PLAIN = 0;

/** A stat-valued entry. */
export const FROM_STAT = 1;

/** A host-valued entry. */
export const FROM_HOST = 2;

/** One compiled modifier as the fold reads it: flat fields, every one present, functions resolved. */
export interface Entry<Host> {
  /** The plain value, or 0 for a computed one. */
  readonly value: number;

  /** `PLAIN`, `FROM_STAT` or `FROM_HOST`. */
  readonly valueKind: number;

  /** The followed stat of a stat-valued entry, else -1. */
  readonly valueStat: number;

  /** The share of a stat-valued entry. */
  readonly per: number;

  /** The neutral of a stat-valued entry. */
  readonly neutral: number;

  /** The cap of a stat-valued entry, `Infinity` for none. */
  readonly cap: number;

  /** The game read of a host-valued entry. */
  readonly read: ValueRead<Host> | undefined;

  /** The argument of the read. */
  readonly readArg: number;

  /** The condition test, or `undefined` for none. */
  readonly test: ConditionTest<Host> | undefined;

  /** The condition's argument. */
  readonly testArg: number;

  /** The scope id, or -1 for unscoped. */
  readonly scope: number;

  /** The source id (its fold position). */
  readonly source: SourceId;

  /** The gate, or -1 for none. */
  readonly gate: number;

  /** Whether a gated `mul` stacks linearly. */
  readonly isLinear: boolean;

  /** The compiled modifier, for explanations. */
  readonly modifier: CompiledModifier;

  /**
   * On a marker, the shared entries it stands for: a sheet's list holds one where the lists every sheet shares fold,
   * and the fold walks the host's held gates there. `undefined` on every modifier's own entry.
   */
  readonly shared: SharedAt<Host> | undefined;
}

/** A stat's adds, muls and mins, each in source order. */
export interface CompiledStat<Host> {
  /** The additions. */
  readonly adds: readonly Entry<Host>[];

  /** The multipliers. */
  readonly muls: readonly Entry<Host>[];

  /** The caps. */
  readonly mins: readonly Entry<Host>[];
}

/** One gate a host holds, as its `held` report lists it: an aura instance, whose `id` is the gate. */
export interface HeldGate {
  /** The gate (an aura id). */
  readonly id: number;
}

/** What a sheet's fold reads from its system. */
export interface FoldTables<Host> {
  /** The stat bases. */
  readonly base: Float64Array;

  /** The final clamp floors. */
  readonly min: Float64Array;

  /** The final clamp ceilings. */
  readonly max: Float64Array;

  /** The derived terms of every stat. */
  readonly derivations: readonly (readonly Derivation[])[];

  /** The host's stacks of a gate. */
  readonly stacks: ((host: Host, gate: number) => number) | undefined;

  /** The gates the host holds, in ascending order; without it a read checks every shared gate. */
  readonly held: ((host: Host) => readonly HeldGate[]) | undefined;

  /** The lists every sheet folds, compiled once for the system. */
  readonly shared: SharedLists<Host>;

  /** A compiled condition as the test and argument a fold entry keeps, bound once per condition. */
  readonly testOf: (condition: CompiledCondition) => BoundTest<Host>;

  /** The value reads, by value id. */
  readonly reads: readonly ValueRead<Host>[];

  /** The source ids, in fold order. */
  readonly sourceIds: readonly SourceId[];

  /** The name of a stat id, for messages. */
  readonly nameOf: (stat: number) => string;
}

/** Folds one stat of a built sheet for its current read: the fold, handed to the sheet's view. */
export type Resolve<Host> = (sheet: Sheet<Host>, stat: StatId) => number;

/**
 * The sheet's stat view: it folds a stat for whatever read is current. The system sets `read` around each top-level
 * read, and conversions read the bearer through it.
 */
export class SheetView<Host> implements StatView, ScaledContext {
  readonly sheet: Sheet<Host>;
  read: FoldRead<Host> | undefined = undefined;
  readonly target: undefined = undefined;
  readonly rank = 1;
  readonly #resolve: Resolve<Host>;

  constructor(sheet: Sheet<Host>, resolve: Resolve<Host>) {
    this.sheet = sheet;
    this.#resolve = resolve;
  }

  get caster(): StatView {
    return this;
  }

  total(stat: StatId): number {
    return this.#resolve(this.sheet, stat);
  }

  base(stat: StatId): number {
    return this.sheet.tables.base[stat] ?? 0;
  }
}

/** The one sheet implementation. */
export class Sheet<Host> implements StatSheet {
  readonly tables: FoldTables<Host>;
  readonly lists: (readonly ModifierList[])[];
  compiled: readonly (CompiledStat<Host> | undefined)[] = [];
  isDirty = true;
  compiles = 0;
  sharedRevision = -1;

  /** Which list the current walk folds, and how (the fold's `ADD`, `MUL`, `MIN` and mode bits); set like `read`. */
  how = 0;

  readonly view: SheetView<Host>;

  constructor(tables: FoldTables<Host>, resolve: Resolve<Host>) {
    this.tables = tables;
    this.lists = tables.sourceIds.map(() => []);
    this.view = new SheetView(this, resolve);
  }
}

/**
 * Whether a public sheet is one of this module's sheets. `Host` is named only by the result: a system hands out sheets
 * of its own host type, which the compiler cannot see through `instanceof`.
 */
const isSheet = <Host>(sheet: StatSheet): sheet is Sheet<Host> => sheet instanceof Sheet;

/** The sheet behind a public `StatSheet`, refusing one made elsewhere. */
export const sheetOf = <Host>(sheet: StatSheet): Sheet<Host> => {
  if (!isSheet<Host>(sheet)) {
    throw new TypeError('A stat sheet must come from the modifier system (system.createSheet()).');
  }

  return sheet;
};
