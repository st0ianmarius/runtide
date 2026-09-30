import type { AnyAreaTriggerDef, AreaTriggerContext } from './area-def.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';

/** What of a kind's live area triggers crosses the wire, as numbers: entries of its declared view. */
export interface AreaReplicationSpec {
  /** The entries of its view (`AreaTriggerDef.view`: a position, a reach, a charge), in the order they are written. */
  readonly values: readonly string[];

  /** A quantum per entry: its value is rounded to the nearest multiple; none when absent. */
  readonly rounding?: Readonly<Record<string, number>>;
}

/**
 * How a kind replicates: its state as numbers (a spec), `events-only` (only its `spawned` and `ended` events
 * and cues cross: a shot the client flies itself, a blade the client recomputes from time and its owner); an area
 * trigger kind that declares nothing is `events-only`.
 */
export type AreaReplication = AreaReplicationSpec | 'events-only';

/** A kind's replication, resolved at load. */
export interface CompiledReplication {
  /** How it replicates. */
  readonly mode: 'state' | 'events-only';

  /** The view entries written, in order. */
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
const EVENTS_ONLY: CompiledReplication = Object.freeze({ mode: 'events-only', names: [], quanta: new Float64Array(0) });

/** Throws unless a spec's entries and quanta are sound. */
const checkSpec = <G extends AreaTriggerTypes>(
  name: string,
  [spec, def]: readonly [AreaReplicationSpec, AnyAreaTriggerDef<G>],
): void => {
  const names = spec.values;

  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new RangeError(`Area trigger ${name}: replicates view entries, at least one, each once.`);
  }

  if (def.view === undefined) {
    throw new RangeError(`Area trigger ${name}: replicates view entries but declares no view.`);
  }

  for (const [key, quantum] of Object.entries(spec.rounding ?? {})) {
    if (!names.includes(key) || !(quantum > 0) || !Number.isFinite(quantum)) {
      throw new RangeError(
        `Area trigger ${name}: rounds ${key}, which needs a replicated value and a quantum above 0.`,
      );
    }
  }
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

  checkSpec(name, [spec, def]);

  return Object.freeze({
    mode: 'state',
    names: Object.freeze([...spec.values]),
    quanta: Float64Array.from(spec.values, (key) => spec.rounding?.[key] ?? 0),
  });
};

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
  const view = engine.registry.get(area.kind).view?.(area);
  const { values } = replica;

  replica.handle = area.handle;
  replica.id = area.id;
  replica.kind = area.kind;
  values.length = spec.names.length;

  for (let at = 0; at < spec.names.length; at++) {
    values[at] = rounded(view?.[spec.names[at] ?? ''] ?? 0, spec.quanta[at] ?? 0);
  }
};

/**
 * Writes the replicated state of every live area trigger whose kind replicates its state (and that `admit` keeps, for
 * one client's interest: those near its unit) into `out` from index 0, kind by kind in registry order and each kind
 * in creation order; returns how many. `out` keeps its replicas and their value arrays between calls.
 */
export const replicateAreas = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  out: AreaReplica[],
  admit?: (area: AreaTriggerContext<G>) => boolean,
): number => {
  let count = 0;

  for (const kind of engine.registry.ids) {
    if (engine.registry.replication[kind]?.mode !== 'state') {
      continue;
    }

    for (let walk = engine.kindHeads[kind]; walk !== undefined; walk = walk.kindNext) {
      if (!walk.isEnding && admit?.(walk) !== false) {
        const replica = (out[count] ??= { handle: NO_AREA_TRIGGER, id: 0, kind, values: [] });

        writeReplica(engine, walk, replica);
        count += 1;
      }
    }
  }

  return count;
};
