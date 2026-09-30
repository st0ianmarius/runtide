import type { CueDef, CueParamDef } from './cue-def.ts';
import { dequantise, ENTITY, PARAM_KINDS, quantise, VEC2_LIST } from './quantise.ts';

/** The most params one cue may declare: its presence mask stays a small whole number. */
const MAX_PARAMS = 30;

/** The steps per turn of an angle that declares none. */
const DEFAULT_STEPS = 65_536;

/** The most steps per turn an angle may declare. */
const MAX_STEPS = 2 ** 30;

/** One param of a cue, compiled at load: what a firing, the encoder and the decoder read, with no lookup. */
export interface CueField {
  /** Its developer name, as the definition's key. */
  readonly param: string;

  /** Its kind code: its kind's index in `PARAM_KINDS`. */
  readonly kind: number;

  /** Its first slot in an event's `values`. */
  readonly slot: number;

  /** Its steps per unit (per turn for an angle); 1 for kinds that have none. */
  readonly scale: number;
}

/**
 * One cue's params, compiled at load, in wire order. A point takes two slots of an event's `values` (x, then
 * z), a list of points two (its first coordinate's index in the event's `path`, then its point count), anything else
 * one.
 */
export interface CueSchema {
  /** The params' names, in wire order. */
  readonly names: readonly string[];

  /** The params, in wire order. */
  readonly fields: readonly CueField[];

  /** Each slot's default value; 0 for both slots of a list of points (no points). */
  readonly defaults: Float64Array;

  /** Each slot's default in wire form: a firing whose wire form equals it leaves the param off the wire. */
  readonly wireDefaults: Float64Array;

  /** How many slots its params take. */
  readonly size: number;
}

/** Throws a load-time error about one cue. */
const refuse = (cue: string, problem: string): never => {
  throw new RangeError(`Cue ${cue}: ${problem}`);
};

/** Whether a number is finite and above 0. */
const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The steps a param declares, before checking: its scale, its steps per turn, or 1 for a kind with none. */
const declaredScale = (param: CueParamDef, positionScale: number): unknown => {
  if (param.kind === 'fixed') {
    return param.scale;
  }

  if (param.kind === 'vec2' || param.kind === 'vec2[]') {
    return param.scale ?? positionScale;
  }

  return param.kind === 'angle' ? (param.steps ?? DEFAULT_STEPS) : 1;
};

/** A param's steps per unit (per turn for an angle), checked. */
const scaleOf = (param: CueParamDef, positionScale: number, where: readonly [string, string]): number => {
  const scale = declaredScale(param, positionScale);

  if (!PARAM_KINDS.includes(param.kind)) {
    refuse(where[0], `${where[1]} has no known kind.`);
  }

  if (param.kind === 'angle') {
    return Number.isInteger(scale) && isPositive(scale) && scale >= 2 && scale <= MAX_STEPS
      ? scale
      : refuse(where[0], `${where[1]} needs whole steps from 2 to 2^30.`);
  }

  return isPositive(scale) ? scale : refuse(where[0], `${where[1]} needs a scale above 0.`);
};

/** A param's default coordinates: none for a list of points, `-1` for an entity. */
const defaultsOf = (param: CueParamDef): readonly number[] => {
  if (param.kind === 'vec2') {
    return [param.default?.x ?? 0, param.default?.z ?? 0];
  }

  if (param.kind === 'vec2[]') {
    return [0, 0];
  }

  return param.kind === 'entity' ? [-1] : [param.default ?? 0];
};

/** Checks that a default is a finite number its quantisation keeps exactly, so an omitted param decodes to it. */
const checkDefault = (kind: number, scale: number, parts: { value: number; where: readonly [string, string] }) => {
  const { value, where } = parts;
  const isKept = Number.isFinite(value) && dequantise(kind, scale, quantise(kind, scale, value)) === value;

  if (!isKept && kind !== VEC2_LIST) {
    refuse(where[0], `the default of ${where[1]} (${value}) is not a value its quantisation keeps exactly.`);
  }
};

/** Checks the rules a whole definition must keep: its anchor, audience, param count and the prediction rule. */
const checkDef = (cue: string, def: CueDef, names: readonly string[]): void => {
  if (!['self', 'entity', 'target', 'world'].includes(def.anchor)) {
    refuse(cue, `unknown anchor ${String(def.anchor)}.`);
  }

  if (def.audience !== undefined && !['owner', 'party', 'all'].includes(def.audience)) {
    refuse(cue, `unknown audience ${String(def.audience)}.`);
  }

  if (names.length > MAX_PARAMS) {
    refuse(cue, `at most ${MAX_PARAMS} params; it has ${names.length}.`);
  }

  if (def.isPredicted === true && def.anchor === 'entity') {
    refuse(cue, 'a predicted cue cannot be anchored to an entity, whose id a predicting client may not know.');
  }
};

/** Compiles one cue's params into its schema, checking every param (at load, never per tick). */
export const compileSchema = (cue: string, def: CueDef, positionScale: number): CueSchema => {
  const params = def.params ?? {};
  const names = Object.keys(params);
  const fields: CueField[] = [];
  const defaults: number[] = [];
  const wireDefaults: number[] = [];

  checkDef(cue, def, names);

  for (const name of names) {
    const param = params[name] ?? refuse(cue, `${name} has no definition.`);
    const scale = scaleOf(param, positionScale, [cue, name]);
    const kind = PARAM_KINDS.indexOf(param.kind);

    if (kind === ENTITY && def.isPredicted === true) {
      refuse(cue, `a predicted cue cannot carry the entity param ${name}.`);
    }

    fields.push(Object.freeze({ param: name, kind, slot: defaults.length, scale }));

    for (const value of defaultsOf(param)) {
      checkDefault(kind, scale, { value, where: [cue, name] });
      defaults.push(value);
      wireDefaults.push(kind === VEC2_LIST ? 0 : quantise(kind, scale, value));
    }
  }

  return Object.freeze({
    names: Object.freeze(names),
    fields: Object.freeze(fields),
    defaults: Float64Array.from(defaults),
    wireDefaults: Float64Array.from(wireDefaults),
    size: defaults.length,
  });
};
