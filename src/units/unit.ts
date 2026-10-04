import type { LoadoutState } from '../abilities/index.ts';
import type { BrainState } from '../ai/index.ts';
import type { AuraState } from '../auras/index.ts';
import type { Bitset } from '../core/index.ts';
import type { StatSheet, StatView } from '../modifiers/index.ts';
import { type CasterState, type CastHandle, NO_CAST } from '../spells/index.ts';
import type { Lifecycle, UnitId, UnitShape, UnitTypes } from './unit-types.ts';

/** A unit's contextual fold read: itself as the host, the target and spell scopes set before each read. */
export interface AgainstRead<G extends UnitTypes> {
  /** The unit. */
  readonly host: G['bearer'];

  /** The unit it is read against. */
  against: G['bearer'] | undefined;

  /** The spell scopes reached by this read, when any. */
  scope: Bitset | undefined;
}

/** What a unit is made with: everything its template and spawn decided, and the states the other systems made. */
export interface UnitParts<G extends UnitTypes> {
  /** Its entity id. */
  readonly id: number;

  /** Its template. */
  readonly template: UnitId;

  /** Its side. */
  readonly side: number;

  /** Its owner. */
  readonly owner: G['bearer'] | undefined;

  /** Whether it despawns with its owner. */
  readonly isBound: boolean;

  /** Its base stats, snapshotted at spawn; read-only (units of a template without stats of their own share them). */
  readonly base: ArrayLike<number>;

  /** Its class tags. */
  readonly tags: Bitset;

  /** Its aura state. */
  readonly auras: AuraState;

  /** Its caster state. */
  readonly casts: CasterState;

  /** Its loadout. */
  readonly loadout: LoadoutState;

  /** Its brain. */
  readonly brain: BrainState;

  /** Its stat sheet, when the game folds stats. */
  readonly sheet: StatSheet | undefined;

  /** The game's own fields. */
  readonly ext: G['unitExt'];
}

/**
 * A unit: the one shape of heroes, creatures and summons, made by the unit system's `spawn`.
 * The systems change it through their operations; the game reads it and writes only its `ext`.
 */
export class Unit<G extends UnitTypes> implements UnitShape {
  readonly id: number;
  readonly template: UnitId;
  side: number;
  owner: G['bearer'] | undefined;

  /** The entity id its deeds are credited to once its owner despawned (orphaned); −1 while it has its owner. */
  credit = -1;
  readonly isBound: boolean;
  readonly auras: AuraState;
  readonly casts: CasterState;
  readonly loadout: LoadoutState;
  readonly brain: BrainState;
  readonly sheet: StatSheet | undefined;
  readonly ext: G['unitExt'];

  /**
   * Its base stats by stat id, snapshotted from its template and spawn: a later template change does not reach it.
   * Read-only: units of a template spawned without stats of their own share one array.
   */
  readonly base: ArrayLike<number>;

  /** Its class tags. */
  readonly tags: Bitset;

  lifecycle: Lifecycle = 'alive';

  /** Whether a lifecycle move of it is running its hooks and events. */
  isMoving = false;

  /**
   * The slot a world keeps it at: what a memory world's `slots` reads and writes (`{ get: (unit) => unit.worldSlot, set:
   * (unit, slot) => { unit.worldSlot = slot } }`); -1 outside one.
   */
  worldSlot = -1;

  /**
   * The moves hooks asked for while one ran (a revive from a death's `onState`, a corpse despawn from a listener), made
   * in order once it is done, each checked again then.
   */
  readonly nextMoves: (readonly [Lifecycle, number | undefined, string | undefined])[] = [];
  health = 0;

  /** The maximum health the resource policy last saw. */
  maxHealth = 0;

  /**
   * The units it owns that are neither dead nor despawned, in the order they joined (a revived one last), whether it
   * lives or not: its summons, which `units.summonsOf` reads.
   */
  readonly summons: G['bearer'][] = [];

  /**
   * Every unit it owns that is not despawned, dead ones too, in the order they spawned: what its despawn takes along
   * (bound ones) or lets go of, and what it takes back into `summons` when it revives.
   */
  readonly owned: G['bearer'][] = [];

  /**
   * The most of its template its owner may keep among its summons, from the summon proc that made it
   * (`limit.perOwner`): a revive rejoins its owner only with room under it. Unlimited for any other spawn.
   */
  perOwner = Number.POSITIVE_INFINITY;

  /** What the limit it was summoned under counts (`limit.of`): its template's summons, or every one of its owner's. */
  perOwnerOf: 'template' | 'any' = 'template';

  /** The cast it was summoned by, held alive while it lives; `NO_CAST` for none. */
  cast: CastHandle = NO_CAST;

  /** The bits of the interrupting states it is in (`UnitSystemBase.interrupts`, by their order), as last synced. */
  interrupts = 0;

  /** Its record in the script system; −1 for none. */
  scriptSlot = -1;

  /** Its stat view, made once (the sheet's view with the unit as the fold's host, or its bases). */
  view: StatView | undefined = undefined;

  /** Its contextual view's read, with the target and spell scopes set at each read; made at the first. */
  againstRead: AgainstRead<G> | undefined = undefined;

  /** Its sheet's contextual view, made at the first read against a target or within spell scopes. */
  againstView: StatView | undefined = undefined;

  constructor(parts: UnitParts<G>) {
    this.id = parts.id;
    this.template = parts.template;
    this.side = parts.side;
    this.owner = parts.owner;
    this.isBound = parts.isBound;
    this.base = parts.base;
    this.tags = parts.tags;
    this.auras = parts.auras;
    this.casts = parts.casts;
    this.loadout = parts.loadout;
    this.brain = parts.brain;
    this.sheet = parts.sheet;
    this.ext = parts.ext;
  }
}
