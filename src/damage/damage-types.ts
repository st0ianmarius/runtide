import type { Id } from '../core/index.ts';
import type { ProcTypes } from '../procs/index.ts';

/** The id of a damage kind: its position in the game's damage kind table (`defineDamageKinds`). */
export type DamageKindId = Id<'damageKinds'>;

/**
 * The types one game's damage, healing and force are written against: the proc types plus what blows carry. A game
 * declares its bundle once and points the aura types' `blow` and `force` at the framework's records, so aura damage
 * hooks read them: `interface Game extends DamageTypes { readonly blow: Blow<Game>; readonly force: Force<Game>; … }`.
 * Every name here is the game's.
 */
export interface DamageTypes extends ProcTypes {
  /** The names of the game's damage kinds (`physical`, `fire`, `environmental`). */
  readonly damageKind: string;

  /**
   * What a blow names as the spell it comes from: opaque to the damage system, which hands it to the host to look up
   * the spell's outgoing-multiplier shares (§II.3.13). Spells hand over their id; `undefined` when a blow has none.
   */
  readonly spell: unknown;

  /** The game's own fields on a blow (§I.5.6 hatch 4), which the framework never reads. */
  readonly blowExt: unknown;
}

/**
 * How a blow ended (a subset of the proc statuses, so a damage proc reports it as is): `skipped` (nothing to act on:
 * no amount, a target already dead, the pipeline too deep), `ignored` (an ignore gate let it pass the target by),
 * `blocked` (a block row or a game stage stopped it), `absorbed` (absorbs ate all of it), `landed` (it reached health,
 * even when that took nothing or a death was prevented), `avoided` (an avoid row: a miss, a dodge, a parry).
 */
export type BlowStatus = 'skipped' | 'ignored' | 'blocked' | 'absorbed' | 'landed' | 'avoided';

/** What a stage may end a blow with; the rest of the blow's stages are skipped and the after-stages still run. */
export type BlowStop = 'ignored' | 'blocked' | 'avoided';

/**
 * A roll slot of the damage pipeline (§II.3.14): an outcome row's name in `independent` mode, `table` for the one draw
 * of `single` mode. The host's `roll` and the options' `rollChance` receive it.
 */
export type RollSlot = string;

/** How a heal ended: `skipped` (no amount, a dead target), `blocked` (a heal-block tag or a stage), `landed`. */
export type HealStatus = 'skipped' | 'blocked' | 'landed';

/** How a force ended: `skipped` (no strength, a dead target), `ignored` (cancelled by a hook or stage), `landed`. */
export type ForceStatus = 'skipped' | 'ignored' | 'landed';

/** What a force is: a knockback away from its origin, a push along a direction, or a pull toward its origin. */
export type ForceKind = 'knock' | 'push' | 'pull';
