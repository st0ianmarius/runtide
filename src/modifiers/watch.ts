import type { FoldRead, StatSheet } from './sheet.ts';
import type { StatId } from './stat-id.ts';

/** What a stat watch needs of the modifier system: its resolve. */
interface Resolving<Host> {
  /** Folds one stat of a sheet for a read. */
  readonly resolve: (sheet: StatSheet, stat: StatId, read?: FoldRead<Host>) => number;
}

/** One stat change, as a watch raises it; the object is reused from one change to the next, so copy what you keep. */
export interface StatChange {
  /** The sheet whose stat moved. */
  sheet: StatSheet;

  /** The stat that moved. */
  stat: StatId;

  /** Its value at the sheet's previous check. */
  before: number;

  /** Its value now. */
  after: number;
}

/** A watch over some stats of every sheet it checks. */
export interface StatWatch<Host> {
  /**
   * Folds the watched stats of a sheet and raises `onChange` for each that moved since the sheet's last check, in the
   * order the stats were listed. A sheet's first check only records its values.
   */
  readonly check: (sheet: StatSheet, read?: FoldRead<Host>) => void;
}

/**
 * Watches stats for changes: the host checks a bearer where its sources or auras may have moved a stat
 * (after an aura change, a rank-up), and hears `onChange({ sheet, stat, before, after })` for each watched stat that
 * moved, so a resource policy (what current health does when maximum health moves) and the wire projections can
 * follow. Values compare with `Object.is`, so a NaN that stays NaN is not a change.
 */
export const watchStats = <Host>(
  system: Resolving<Host>,
  options: {
    /** The stats watched, in the order changes are raised. */
    readonly stats: readonly StatId[];

    /** Hears each change. */
    readonly onChange: (change: Readonly<StatChange>) => void;
  },
): StatWatch<Host> => {
  const last = new WeakMap<StatSheet, Float64Array>();
  const stats = [...options.stats];
  let change: StatChange | undefined;

  return {
    check: (sheet, read) => {
      const known = last.get(sheet);
      const values = known ?? new Float64Array(stats.length);

      // An indexed loop: a watch checks every sheet every tick, and an entries iterator allocates.
      for (let index = 0; index < stats.length; index++) {
        const stat = stats[index] ?? missingStat();
        const after = system.resolve(sheet, stat, read);
        const before = values[index] ?? 0;

        values[index] = after;

        if (known !== undefined && !Object.is(before, after)) {
          change ??= { sheet, stat, before, after };
          change.sheet = sheet;
          change.stat = stat;
          change.before = before;
          change.after = after;
          options.onChange(change);
        }
      }

      last.set(sheet, values);
    },
  };
};

/** A watched stat index out of range: the loop bounds prevent it. */
const missingStat = (): never => {
  throw new RangeError('A stat watch lost a stat.');
};
