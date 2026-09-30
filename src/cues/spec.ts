// Hot path: every cue fired from a spec writes its params here, so the loop is indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { Vec2 } from '../math/index.ts';
import type { CueBuffer } from './buffer.ts';
import type { CueParamDef, CueParamValue } from './cue-def.ts';
import { type CueName, type CueRegistry, type CueTable, ON_ENTITY, SELF, WORLD } from './define-cues.ts';
import { type CueEvent, NO_ENTITY, setCuePath } from './event.ts';
import { type CueId, type CueIdOf, toCueParam } from './ids.ts';
import { VEC2, VEC2_LIST } from './quantise.ts';
import type { CueField } from './schema.ts';

/**
 * What a hook asks to show: a cue, its params by name, and optionally the point it sits at and a predicted
 * cue's key. It says nothing about whose it is or which entity it sits on: whoever fires it knows that (the procs'
 * unit, a spell's caster) and hands it over as a `CuePlace`. It is plain data, so a hook may return a reused one.
 */
export interface CueSpec {
  /** The cue. */
  readonly cue: CueId;

  /** Its params by name; a param left out keeps its default. */
  readonly params?: Readonly<Record<string, CueParamValue>> | undefined;

  /** The point it sits at, in place of the place's own. */
  readonly at?: Vec2 | undefined;

  /** A predicted cue's key; 0 when absent. */
  readonly key?: number | undefined;
}

/** The params of one entry of a cue table, by name. */
type ParamsOf<Entry> = Entry extends { readonly params: infer Params } ? Params : Readonly<Record<never, never>>;

/** The typed params of one cue: each optional, of its kind's value type. */
type TypedParams<Params> = {
  readonly [Name in keyof Params]?: Params[Name] extends CueParamDef ? CueParamValue<Params[Name]> : never;
};

/**
 * A `CueSpec` typed by the game's cue table (`CueSpecOf<typeof CUE_TABLE>`): written with `CUES.id.impact`, it only
 * takes the impact cue's params, each of its kind's type. What a spell's `cues` hooks return.
 */
export type CueSpecOf<Table extends CueTable> = {
  [Name in CueName<Table>]: Omit<CueSpec, 'cue' | 'params'> & {
    /** The cue. */
    readonly cue: CueIdOf<Name>;

    /** Its params by name. */
    readonly params?: TypedParams<ParamsOf<Table[Name]>>;
  };
}[CueName<Table>];

/**
 * Where a fired cue sits and whose it is, as its firer resolved them from units: the owner's entity id, the entity it
 * sits on, and the point. The cue's anchor decides what is kept: a `self` cue sits on its owner, a `world` cue is
 * nobody's, and only an `entity` cue keeps `entity`.
 */
export interface CuePlace {
  /** Whose it is: the acting unit's entity id, or `NO_ENTITY`. */
  readonly owner: number;

  /** The entity it sits on, for an `entity` cue. */
  readonly entity: number;

  /** The across coordinate. */
  readonly x: number;

  /** The forward coordinate. */
  readonly z: number;
}

/** The fields of a cue that has none. */
const NO_FIELDS: readonly CueField[] = Object.freeze([]);

/** Whether a param value is a list of points. */
const isPoints = (value: CueParamValue): value is readonly Vec2[] => Array.isArray(value);

/** Throws: a param was given a value of the wrong kind. */
const wrongKind = (name: string): never => {
  throw new TypeError(`Cue param ${name} was given a value of the wrong kind.`);
};

/** Writes one param's value into an event. */
const writeParam = (event: CueEvent, field: CueField, value: CueParamValue): void => {
  const { kind, slot } = field;

  if (kind === VEC2_LIST) {
    setCuePath(event, toCueParam(slot), isPoints(value) ? value : wrongKind(field.param));
  } else if (kind === VEC2) {
    const point = typeof value === 'object' && !isPoints(value) ? value : wrongKind(field.param);

    event.values[slot] = point.x;
    event.values[slot + 1] = point.z;
  } else {
    event.values[slot] = typeof value === 'number' ? value : wrongKind(field.param);
  }
};

/** Writes a spec's params into an event, in the cue's param order; names it does not declare are ignored. */
const writeParams = (event: CueEvent, registry: CueRegistry, params: Readonly<Record<string, CueParamValue>>) => {
  const fields = registry.schemas[event.cue]?.fields ?? NO_FIELDS;

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const value = field === undefined ? undefined : params[field.param];

    if (field !== undefined && value !== undefined) {
      writeParam(event, field, value);
    }
  }
};

/**
 * Fires a spec into a buffer at a place: appends the event, placed by the cue's anchor (a `self` cue on its
 * owner, a `world` cue nobody's, the spec's `at` over the place's point), with the spec's key and params. Returns the
 * event, still writable. Throws a `TypeError` for a param value of the wrong kind; unknown names are ignored here, and
 * refused at load by `checkCueSpec`.
 */
export const fireCue = (buffer: CueBuffer, spec: CueSpec, place: CuePlace): CueEvent => {
  const event = buffer.emit(spec.cue);
  const anchor = buffer.registry.columns.anchor[spec.cue];

  event.owner = anchor === WORLD ? NO_ENTITY : place.owner;

  if (anchor === SELF) {
    event.entity = event.owner;
  } else if (anchor === ON_ENTITY) {
    event.entity = place.entity;
  }

  event.x = spec.at?.x ?? place.x;
  event.z = spec.at?.z ?? place.z;
  event.key = spec.key ?? 0;

  if (spec.params !== undefined) {
    writeParams(event, buffer.registry, spec.params);
  }

  return event;
};

/** Whether a value suits a param's kind. */
const suits = (def: CueParamDef, value: unknown): boolean => {
  if (def.kind === 'vec2[]') {
    return Array.isArray(value);
  }

  if (def.kind === 'vec2') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  return typeof value === 'number';
};

/**
 * Checks a spec at load: a live cue, every param one it declares with a value of its kind, and a key only on
 * a predicted cue. Throws a `RangeError` naming `what`.
 */
export const checkCueSpec = (
  registry: CueRegistry,
  spec: Pick<CueSpec, 'cue' | 'params' | 'key'>,
  what: string
): void => {
  const def = registry.schemas[spec.cue] === undefined ? undefined : registry.get(spec.cue);

  const refuse = (problem: string): never => {
    throw new RangeError(`${what}: ${problem}`);
  };

  if (def === undefined) {
    refuse(`${spec.cue} is not a live cue id.`);
  }

  const params = def?.params ?? {};

  for (const [name, value] of Object.entries(spec.params ?? {})) {
    const param = params[name];

    if (param === undefined) {
      refuse(`cue ${registry.name(spec.cue)} has no param ${name}.`);
    } else if (!suits(param, value)) {
      refuse(`cue ${registry.name(spec.cue)}'s param ${name} takes a ${param.kind}.`);
    }
  }

  if (spec.key !== undefined && def?.isPredicted !== true) {
    refuse(`cue ${registry.name(spec.cue)} is not predicted, so it takes no key.`);
  }
};
