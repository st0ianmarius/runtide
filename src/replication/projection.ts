import { type FoldRead, type ModifierSystem, sourceMask, type StatId, type StatSheet } from '../modifiers/index.ts';

/** What a projection folds: stats by name, and optionally only some sources (a partial fold). */
export interface ProjectionSpec<S extends string, Src extends string> {
  /** The stats projected, in the order they are written. */
  readonly stats: readonly S[];

  /**
   * The sources folded; every source when absent. A partial fold is the synced base of a split fold: the
   * server sends the stats folded without the sources a mirror evaluates itself, and the mirror multiplies its own in.
   */
  readonly sources?: readonly Src[];
}

/**
 * A declared stat projection: the stats the wire and a prediction mirror read of a bearer, folded over
 * the chosen sources, written as plain numbers. Built once at load; writing it allocates nothing.
 */
export interface StatProjection<Host> {
  /** The stats written, in order. */
  readonly stats: readonly StatId[];

  /** Their names, in order. */
  readonly names: readonly string[];

  /** The mask of the sources folded; `undefined` for every source. */
  readonly sources: number | undefined;

  /** Writes a sheet's projected stats into `out` from index 0 (conditions and gates read `host`); returns `out`. */
  readonly write: <Out extends Record<number, number>>(sheet: StatSheet, out: Out, host?: Host) => Out;
}

/** The fold read a projection reuses: the host it was handed and its source mask. */
class ProjectionRead<Host> implements FoldRead<Host> {
  host: Host | undefined = undefined;
  readonly sources: number | undefined;

  constructor(sources: number | undefined) {
    this.sources = sources;
  }
}

/**
 * Declares a stat projection over a modifier system: `defineProjection(modifiers, { stats: ['moveSpeed',
 * 'dashSpeed'], sources: ['base', 'gear'] })`. Throws for a stat the table does not have.
 */
export const defineProjection = <Host, S extends string, C extends string, V extends string, Src extends string>(
  modifiers: ModifierSystem<Host, S, C, V, Src>,
  spec: ProjectionSpec<NoInfer<S>, NoInfer<Extract<Src, string>>>,
): StatProjection<Host> => {
  const stats = spec.stats.map((name) => {
    const id = modifiers.stats.index.idOf(name);

    if (id === undefined) {
      throw new RangeError(`A stat projection names no stat ${name}.`);
    }

    return id;
  });

  const sources = spec.sources === undefined ? undefined : sourceMask(modifiers.sources, spec.sources);
  const read = new ProjectionRead<Host>(sources);

  return Object.freeze({
    stats: Object.freeze(stats),
    names: Object.freeze([...spec.stats]),
    sources,

    write: <Out extends Record<number, number>>(sheet: StatSheet, out: Out, host?: Host): Out => {
      read.host = host;

      // Indexed, as a projection is written per bearer per snapshot.
      for (let i = 0; i < stats.length; i++) {
        const stat = stats[i];

        out[i] = stat === undefined ? 0 : modifiers.resolve(sheet, stat, read);
      }

      read.host = undefined;

      return out;
    },
  });
};
