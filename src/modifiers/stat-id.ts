import type { Id } from '../core/index.ts';
import type { Curve, CurveId } from './curves.ts';

/** The id of a stat: its position in the game's stat table (`defineStats`). */
export type StatId = Id<'stats'>;

/**
 * What compiling a scaled value or a curve needs to know about the stat table, by stat name: kept apart from the table
 * itself so that the table can compile its own conversions while it is being built.
 */
export interface StatIndex {
  /** The id of a stat name, or `undefined` for a name the table does not have. */
  readonly idOf: (name: string) => StatId | undefined;

  /** The name of a stat id, for messages. */
  readonly nameOf: (stat: StatId) => string;

  /** Whether a stat is a multiplier stat (else a flat one). */
  readonly isMultiplier: (stat: StatId) => boolean;

  /** A stat's base in the table. */
  readonly baseOf: (stat: StatId) => number;

  /** A stat's neutral value: what an `amp` term or a stat-valued modifier measures its bonus from. */
  readonly neutralOf: (stat: StatId) => number;

  /** The ids of the stats whose definitions declare the named curve (`curve: 'haste'`). */
  readonly declaring: (curve: string) => readonly StatId[];

  /** The game's named curve of this name, or `undefined`. */
  readonly curveNamed: (name: string) => NamedCurve | undefined;
}

/** A curve found by name in the game's curve table. */
export interface NamedCurve {
  /** Its id in the table. */
  readonly id: CurveId;

  /** Its definition. */
  readonly curve: Curve;
}
