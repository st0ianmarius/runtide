import type { LoadoutState } from '../abilities/index.ts';
import type { BrainState } from '../ai/index.ts';
import type { AuraState } from '../auras/index.ts';
import type { Bitset } from '../core/index.ts';
import type { StatSheet, StatView } from '../modifiers/index.ts';
import { type CasterState, type CastHandle, NO_CAST } from '../spells/index.ts';
import type { Lifecycle, UnitId, UnitShape, UnitTypes } from './unit-types.ts';

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

  /** Its base stats, snapshotted at spawn. */
  readonly base: Float64Array;

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
 * A unit (§I.7.1 F13, §II.6 U1): the one shape of heroes, creatures and summons, made by the unit system's `spawn`.
 * The systems change it through their operations; the game reads it and writes only its `ext`.
 */
export class Unit<G extends UnitTypes> implements UnitShape {
  readonly id: number;
  readonly template: UnitId;
  readonly side: number;
  readonly owner: G['bearer'] | undefined;
  readonly isBound: boolean;
  readonly auras: AuraState;
  readonly casts: CasterState;
  readonly loadout: LoadoutState;
  readonly brain: BrainState;
  readonly sheet: StatSheet | undefined;
  readonly ext: G['unitExt'];

  /** Its base stats by stat id, snapshotted from its template and spawn: a later template change does not reach it. */
  readonly base: Float64Array;

  /** Its class tags. */
  readonly tags: Bitset;

  lifecycle: Lifecycle = 'standing';
  health = 0;

  /** The maximum health the resource policy last saw (§II.6 M7). */
  maxHealth = 0;

  /**
   * The units it owns that are neither dead nor despawned, in the order they spawned (§I.7.1 F18): its summons, which
   * `units.summonsOf` reads.
   */
  readonly summons: G['bearer'][] = [];

  /** The cast it was summoned by, held alive while it lives (§II.6 S6); `NO_CAST` for none. */
  cast: CastHandle = NO_CAST;

  /** The bits of the interrupting states it is in (`UnitSystemBase.interrupts`, by their order), as last synced. */
  interrupts = 0;

  /** Its stat view, made once (the sheet's view with the unit as the fold's host, or its bases). */
  view: StatView | undefined = undefined;

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
