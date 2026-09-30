import type { Id } from '../core/index.ts';
import type { SpellTypes } from '../spells/index.ts';

/** The id of an area trigger kind: its position in the area trigger registry, which is also its wire id. */
export type AreaTriggerId = Id<'areaTriggers'>;

/** The id of an area trigger tag: its position in the game's area trigger tag table. */
export type AreaTagId = Id<'areaTags'>;

/**
 * The types one game's area triggers are written against: the spell types (an area trigger belongs to a cast and runs
 * procs) plus what area triggers name. A game declares its bundle once (`interface Game extends AreaTriggerTypes`).
 */
export interface AreaTriggerTypes extends SpellTypes {
  /** The names of the game's area trigger kinds, by which `spawn` procs name them before the registry exists. */
  readonly areaTriggerName: string;

  /** The names of the game's area trigger tags (`dome`, `pool`, `shelter`): what `coveredBy` and queries read. */
  readonly areaTag: string;

  /** What a spawn hands an area trigger (`init` reads it): a heading, a locked target, a pattern index. */
  readonly areaInput: unknown;

  /** The game's own fields on an area trigger (`c.ext`), made by the system's `createExt`. */
  readonly areaExt: unknown;

  /**
   * The game's own reasons an area trigger ends (`phase`: a boss phase clearing its hazards), which it despawns them
   * with and lists in the area trigger registry's `endReasons`; `never` when it has none.
   */
  readonly endReason: string;
}
