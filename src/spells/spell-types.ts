import type { AuraBearer } from '../auras/index.ts';
import type { Id } from '../core/index.ts';
import type { ProcTypes } from '../procs/index.ts';
import type { CasterState } from './caster.ts';

/** The id of a spell: its position in the spell registry (`defineSpells`), which is also its wire id. */
export type SpellId = Id<'spells'>;

/** The id of a spell tag: its position in the game's spell tag table (`defineSpellTags`). */
export type SpellTagId = Id<'spellTags'>;

/** The id of an activation kind: its position in the activation registry (`defineActivations`). */
export type ActivationKindId = Id<'activations'>;

/**
 * A unit that casts: any aura bearer that also holds a caster state (`spells.createCasterState()`), where the spell
 * system keeps the casts it runs and its `auto` clocks, so every per-caster operation is a field read.
 */
export interface SpellCaster extends AuraBearer {
  /** The caster's casts and clocks, made by the spell system; the game never writes it. */
  readonly casts: CasterState;
}

/**
 * The fields every activation has, whatever its kind: the kind's name in the activation registry. A game's own kinds
 * (§I.5.6 hatch 2) are shaped like this: `{ kind: 'totem', pulse: 2 }`.
 */
export interface ActivationShape {
  /** The kind's name in the activation registry: the discriminant, a developer identifier. */
  readonly kind: string;
}

/**
 * The types one game's spells are written against: the proc types (spell hooks return procs) plus what spells name.
 * A game declares its bundle once (`interface Game extends SpellTypes { … }`) and fixes it with `defineSpell<Game>()`.
 * Every name here is the game's.
 */
export interface SpellTypes extends ProcTypes {
  /** What casts spells and what procs land on: a caster holds a caster state beside its auras. */
  readonly bearer: SpellCaster;

  /** The names of the game's spells, by which data procs (`castSpell`) name them before the registry exists. */
  readonly spellName: string;

  /** The names of the game's spell tags (`area`, `fire`, `creature`): modifier scopes, trigger filters, classes. */
  readonly spellTag: string;

  /** What the system that pulls a spell's trigger hands its cast: an aim point, a direction, a unit. */
  readonly input: unknown;

  /**
   * The game's own reasons a gate refuses a cast (`silenced`, `noRage`), which the host's `canAct`, an activation
   * kind's `gate` and a spell's `canCast` may answer with in place of a plain false (§I.7.1 F16).
   */
  readonly refusal: string;

  /**
   * The game's own ways a cast can end (`blocked`: a charge into a wall), which it ends casts with through
   * `spells.finish` and lists in the spell registry's `outcomes`; `never` when it has none.
   */
  readonly castOutcome: string;

  /** The reasons a cast can be interrupted (`stun`, `freeze`, `death`), which a timeline maps to pause or cancel. */
  readonly interrupt: string;

  /** The data of the game's own activation kinds, as a union (`never` when it has none). */
  readonly gameActivation: ActivationShape;

  /** The game's own fields on a running cast (`ctx.ext`), made by the system's `createExt` (§I.5.6 hatch 4). */
  readonly castExt: unknown;

  /** The game's own data on a spell definition (`SpellDef.data`), which the framework never reads. */
  readonly spellData: unknown;
}
