import { boundsOf, emptyBox } from '../math/index.ts';
import type { AnyAreaTriggerDef } from './area-def.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';

/**
 * The fields of an area trigger a kind may replicate (§II.3.9): its position, heading and reach (the half extent of
 * its shape's bounds), the tick it spawned on, its lifetime in seconds (its age plus its time left) and its age.
 */
export const AREA_FIELDS = ['x', 'z', 'heading', 'radius', 'started', 'duration', 'age'] as const;

/** A field an area trigger kind may replicate. */
export type AreaField = (typeof AREA_FIELDS)[number];

/** What of a kind's live area triggers crosses the wire, as numbers. */
export interface AreaReplicationSpec {
  /** Its fields, in the order they are written. */
  readonly fields: readonly AreaField[];

  /** Entries of its declared view (`AreaTriggerDef.view`), written after the fields, in this order. */
  readonly extra?: readonly string[];

  /** A quantum per field or extra entry: its value is rounded to the nearest multiple; none when absent. */
  readonly rounding?: Readonly<Record<string, number>>;
}

/**
 * How a kind replicates (§II.3.9): its state as numbers (a spec), `events-only` (only its `spawned` and `ended` events
 * and cues cross: a shot the client flies itself) or `derived` (the client recomputes it from time and the owner); an
 * area trigger kind that declares nothing is `events-only`.
 */
export type AreaReplication = AreaReplicationSpec | 'events-only' | 'derived';

/** A kind's replication, resolved at load. */
export interface CompiledReplication {
  /** How it replicates. */
  readonly mode: 'state' | 'events-only' | 'derived';

  /** Each field's code (its index in `AREA_FIELDS`). */
  readonly fields: readonly number[];

  /** The view entries after the fields. */
  readonly extra: readonly string[];

  /** The names of the values written, fields then extra entries. */
  readonly names: readonly string[];

  /** The quantum of each value, 0 for none. */
  readonly quanta: Float64Array;
}

/** One live area trigger's replicated state, reused by `replicate`: read it at once. */
export interface AreaReplica {
  /** Its handle. */
  handle: AreaTriggerHandle;

  /** Its entity id, which its cues and events carry. */
  id: number;

  /** Its kind. */
  kind: AreaTriggerId;

  /** Its values, in its kind's order (`registry.replication[kind].names`). */
  readonly values: number[];
}

/** The replication of a kind that sends none: only its events. */
const EVENTS_ONLY: CompiledReplication = Object.freeze({
  mode: 'events-only',
  fields: [],
  extra: [],
  names: [],
  quanta: new Float64Array(0),
});

/** The replication of a kind the client derives. */
const DERIVED: CompiledReplication = Object.freeze({ ...EVENTS_ONLY, mode: 'derived' });

/** Throws unless every quantum rounds a replicated value and is a finite number above 0. */
const checkRounding = (name: string, [spec, names]: readonly [AreaReplicationSpec, readonly string[]]): void => {
  for (const [key, quantum] of Object.entries(spec.rounding ?? {})) {
    if (!names.includes(key) || !(quantum > 0) || !Number.isFinite(quantum)) {
      throw new RangeError(
        `Area trigger ${name}: rounds ${key}, which needs a replicated value and a quantum above 0.`,
      );
    }
  }
};

/** Throws unless a spec's fields, extra entries and quanta are sound. */
const checkSpec = <G extends AreaTriggerTypes>(
  name: string,
  [spec, def]: readonly [AreaReplicationSpec, AnyAreaTriggerDef<G>],
): void => {
  const fields: readonly string[] = AREA_FIELDS;
  const names = [...spec.fields, ...(spec.extra ?? [])];
  const unknown = spec.fields.find((field) => !fields.includes(field));

  if (unknown !== undefined || names.length === 0 || new Set(names).size !== names.length) {
    throw new RangeError(`Area trigger ${name}: replicates known fields, at least one, each once.`);
  }

  if ((spec.extra ?? []).length > 0 && def.view === undefined) {
    throw new RangeError(`Area trigger ${name}: replicates view entries but declares no view.`);
  }

  checkRounding(name, [spec, names]);
};

/** Resolves a kind's replication at load (`events-only` for a tombstone), checking its spec. */
export const compileReplication = <G extends AreaTriggerTypes>(
  name: string,
  def: AnyAreaTriggerDef<G> | undefined,
): CompiledReplication => {
  const spec = def?.replicate;

  if (def === undefined || spec === undefined || spec === 'events-only') {
    return EVENTS_ONLY;
  }

  if (spec === 'derived') {
    return DERIVED;
  }

  checkSpec(name, [spec, def]);

  const fields: readonly string[] = AREA_FIELDS;
  const names = [...spec.fields, ...(spec.extra ?? [])];

  return Object.freeze({
    mode: 'state',
    fields: Object.freeze(spec.fields.map((field) => fields.indexOf(field))),
    extra: Object.freeze([...(spec.extra ?? [])]),
    names: Object.freeze(names),
    quanta: Float64Array.from(names, (key) => spec.rounding?.[key] ?? 0),
  });
};

/** The reused box a reach is measured in. */
const BOX = emptyBox();

/** What a field is read from: a live area trigger's public numbers and its placed shape. */
type FieldSource = Pick<
  AreaTrigger<AreaTriggerTypes>,
  'position' | 'heading' | 'shape' | 'spawnTick' | 'age' | 'remaining'
>;

/** The half extent of an area trigger's shape bounds: its reach. */
const reachOf = (area: FieldSource): number => {
  boundsOf(area.shape, 0, BOX);

  return Math.max(BOX.maxX - BOX.minX, BOX.maxZ - BOX.minZ) / 2;
};

/** How each field is read, by field code. */
const FIELD_READS: readonly ((area: FieldSource) => number)[] = [
  (area) => area.position.x,
  (area) => area.position.z,
  (area) => area.heading,
  reachOf,
  (area) => area.spawnTick,
  (area) => area.age + area.remaining,
  (area) => area.age,
];

/** A value rounded to the nearest multiple of its quantum; as it is for none, or for an infinite value. */
const rounded = (value: number, quantum: number): number =>
  quantum > 0 && Number.isFinite(value) ? Math.round(value / quantum) * quantum : value;

/** Writes one area trigger's values into its replica. */
const writeReplica = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  replica: AreaReplica,
): void => {
  const spec = engine.registry.replication[area.kind] ?? EVENTS_ONLY;
  const view = spec.extra.length === 0 ? undefined : engine.registry.get(area.kind).view?.(area);
  const { values } = replica;
  let at = 0;

  replica.handle = area.handle;
  replica.id = area.id;
  replica.kind = area.kind;
  values.length = spec.names.length;

  for (const code of spec.fields) {
    values[at] = rounded(FIELD_READS[code]?.(area) ?? 0, spec.quanta[at] ?? 0);
    at += 1;
  }

  for (const key of spec.extra) {
    values[at] = rounded(view?.[key] ?? 0, spec.quanta[at] ?? 0);
    at += 1;
  }
};

/**
 * Writes the replicated state of every live area trigger whose kind replicates its state into `out` from index 0 (§I.6
 * Replication), kind by kind in registry order and each kind in creation order; returns how many. `out` keeps its
 * replicas and their value arrays between calls.
 */
export const replicateAreas = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, out: AreaReplica[]): number => {
  let count = 0;

  for (const kind of engine.registry.ids) {
    if (engine.registry.replication[kind]?.mode !== 'state') {
      continue;
    }

    for (let walk = engine.kindHeads[kind]; walk !== undefined; walk = walk.kindNext) {
      if (!walk.isEnding) {
        const replica = (out[count] ??= { handle: NO_AREA_TRIGGER, id: 0, kind, values: [] });

        writeReplica(engine, walk, replica);
        count += 1;
      }
    }
  }

  return count;
};
