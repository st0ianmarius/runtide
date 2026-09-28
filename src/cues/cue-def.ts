import type { Vec2 } from '../math/index.ts';

/**
 * Where a cue sits and whose it is (§II.6 R1), which decides what of its placement crosses the wire:
 *
 * - `self`: on the acting unit, and that unit's: the event's `entity` is its `owner` (a cast, being hurt, an aura's
 *   landing on its bearer).
 * - `entity`: on another entity, which the client may follow (an impact on a creature, a beam on its target), and the
 *   owner's.
 * - `target`: at a point the firing names (a strike, a placement), still the owner's.
 * - `world`: at a point, and nobody's (a wave's horn, a level-up): its `owner` is `NO_ENTITY`.
 */
export type CueAnchor = 'self' | 'entity' | 'target' | 'world';

/**
 * Who receives a cue (§II.6 R1), which the server routes by (`cueReaches`): its `owner` alone, the owner's party, or
 * every client that sees the world. A `world` cue has no owner, so it reaches everyone whatever it declares.
 */
export type CueAudience = 'owner' | 'party' | 'all';

/** A 32-bit float param (`Math.fround`), exact to float32: four bytes on the wire. */
export interface CueF32Param {
  /** The discriminant. */
  readonly kind: 'f32';

  /** Its value when a firing gives none; 0 when absent. It must be a float32. */
  readonly default?: number;
}

/**
 * A fixed-point param: a whole number of `1 / scale` steps (`scale: 100` is centimetres, `1000` milliseconds), as a
 * signed varint. The value crosses as `round(value × scale) / scale`.
 */
export interface CueFixedParam {
  /** The discriminant. */
  readonly kind: 'fixed';

  /** Steps per unit: a finite number above 0. */
  readonly scale: number;

  /** Its value when a firing gives none; 0 when absent. It must be a whole number of steps. */
  readonly default?: number;
}

/** A whole number (rounded), as a signed varint: a count, a stack, an amount shown whole. */
export interface CueIntParam {
  /** The discriminant. */
  readonly kind: 'int';

  /** Its value when a firing gives none; 0 when absent. */
  readonly default?: number;
}

/** A whole number from 0 to 255 (rounded and clamped), one byte: an index into the client's table, a flag. */
export interface CueUint8Param {
  /** The discriminant. */
  readonly kind: 'uint8';

  /** Its value when a firing gives none; 0 when absent. */
  readonly default?: number;
}

/**
 * An angle in radians, wrapped into [−π, π) and quantised to `steps` per full turn (65,536 when absent, under 0.006°),
 * as an unsigned varint: a facing, a sweep.
 */
export interface CueAngleParam {
  /** The discriminant. */
  readonly kind: 'angle';

  /** Steps per full turn: a whole number from 2 to 2³⁰. */
  readonly steps?: number;

  /** Its value when a firing gives none; 0 when absent. It must be in [−π, π) and on a step. */
  readonly default?: number;
}

/** A point or direction on the ground, each coordinate fixed-point at `scale` (the registry's position scale when absent). */
export interface CueVec2Param {
  /** The discriminant. */
  readonly kind: 'vec2';

  /** Steps per unit; the registry's `positionScale` when absent. */
  readonly scale?: number;

  /** Its value when a firing gives none; the origin when absent. Both coordinates must be on a step. */
  readonly default?: Vec2;
}

/**
 * A polyline (a chain's links, a path): points fixed-point at `scale`, each after the first as its step from the one
 * before. Its default is no points.
 */
export interface CueVec2ListParam {
  /** The discriminant. */
  readonly kind: 'vec2[]';

  /** Steps per unit; the registry's `positionScale` when absent. */
  readonly scale?: number;
}

/**
 * An entity id (a unit, an area trigger), `NO_ENTITY` for none, which is also its default. A predicted cue may not
 * have one: server-allocated ids are unknown to a predicting client (§II.6 R2).
 */
export interface CueEntityParam {
  /** The discriminant. */
  readonly kind: 'entity';
}

/** A dense registry id (a spell, an aura, a damage kind): a whole number from 0, as an unsigned varint. */
export interface CueIdParam {
  /** The discriminant. */
  readonly kind: 'id';

  /** Its value when a firing gives none; 0 when absent. */
  readonly default?: number;
}

/**
 * One numeric param of a cue (§I.5.3, §II.6 R1): its kind decides its value's type and its wire quantisation. There is
 * no string kind: words, colours and sounds are the client's, keyed by the cue id and these numbers.
 */
export type CueParamDef =
  | CueF32Param
  | CueFixedParam
  | CueIntParam
  | CueUint8Param
  | CueAngleParam
  | CueVec2Param
  | CueVec2ListParam
  | CueEntityParam
  | CueIdParam;

/** The kind of a cue param. */
export type CueParamKind = CueParamDef['kind'];

/** The value a firing gives a param of one definition: a point, a list of points, or a number. */
export type CueParamValue<Def extends CueParamDef = CueParamDef> = Def extends CueVec2Param
  ? Vec2
  : Def extends CueVec2ListParam
    ? readonly Vec2[]
    : number;

/**
 * One cue (§I.6): which numeric params it takes, their defaults and quantisation, where it sits and who receives it.
 * Nothing else: what it looks and sounds like is the client's table, keyed by its id (§I.5.3). It carries no id; the
 * registry key is its developer name and its position is its id.
 */
export interface CueDef {
  /** Where it sits and whose it is. */
  readonly anchor: CueAnchor;

  /** Who receives it; everyone when absent. */
  readonly audience?: CueAudience;

  /**
   * Whether a client may fire it ahead of the server (§II.6 R2): its events carry a key the server's copy repeats, so
   * the client drops the echo (`createCueEchoes`). It may have no `entity` anchor or param.
   */
  readonly isPredicted?: boolean;

  /** Its params by name, in wire order; at most 30. None when absent. */
  readonly params?: Readonly<Record<string, CueParamDef>>;
}

/** Fixes a cue definition's types, keeping its params' literal kinds; returns it unchanged. */
export const defineCue = <const Def extends CueDef>(def: Def): Def => def;
