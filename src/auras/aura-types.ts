import type { Id } from '../core/index.ts';
import type { AuraBearer } from './state.ts';

/** The id of an aura: its position in the aura registry, which is also its fold order, walk order and wire id. */
export type AuraId = Id<'auras'>;

/** The id of an aura tag: its position in the game's tag table (`defineAuraTags`). */
export type AuraTagId = Id<'auraTags'>;

/**
 * The types one game's auras are written against, bundled so that every aura type takes a single parameter. A game
 * declares its own bundle once (`interface GameAuras extends AuraTypes { readonly bearer: Unit; … }`) and writes its
 * definitions with `defineAura<GameAuras>`. Every name here is the game's; the framework names none of them.
 */
export interface AuraTypes {
  /** What auras land on: any unit, or anything else that holds an aura state. */
  readonly bearer: AuraBearer;

  /** What hooks return: opaque to the aura system, which hands them to its host to run. */
  readonly proc: unknown;

  /** What `AuraDef.triggers` lists: opaque to the aura system; the trigger system compiles them. */
  readonly trigger: unknown;

  /** The names of the game's stats, which aura modifiers change. */
  readonly stat: string;

  /** The names of the game's modifier conditions (`never` when it has none). */
  readonly condition: string;

  /** The names of the game's modifier value kinds (`never` when it has none). */
  readonly valueKind: string;

  /** The names of the game's modifier sources, one of which is where an aura's modifiers fold. */
  readonly source: string;

  /** The names of the game's aura tags. */
  readonly tag: string;

  /** The names of the clocks auras count on. */
  readonly clock: string;

  /** The names of the bearer states whose entry can remove an aura (`removedOn`). */
  readonly state: string;

  /** The blow the damage hooks read (the damage pipeline's, once it lands). */
  readonly blow: unknown;

  /** The force the force hooks read (knockback, push, pull). */
  readonly force: unknown;

  /** The game's own data on a definition (`AuraDef.data`), which the framework never reads. */
  readonly data: unknown;

  /** The game's own fields on a running aura (`ActiveAura.ext`), made by the system's `createExt`. */
  readonly ext: unknown;

  /** What an application hands the aura's `onLand` hook (`AuraApplication.payload`): a snapshot, a variant. */
  readonly payload: unknown;
}
