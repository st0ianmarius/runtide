import type { CueBuffer } from './buffer.ts';
import { type CueRegistry, ON_ENTITY, SELF, WORLD } from './define-cues.ts';
import { type CueEvent, cueRecordOf, NO_ENTITY } from './event.ts';
import { toCueId } from './ids.ts';
import { dequantise, ENTITY, F32, FIXED, INT, quantise, VEC2, VEC2_LIST } from './quantise.ts';
import type { CueField } from './schema.ts';
import type { CueReader, CueWriter } from './wire.ts';

/** Throws: the data does not describe a cue of this registry. */
const corrupt = (problem: string): never => {
  throw new RangeError(`Cue data ${problem}.`);
};

/** An entity id's wire form: the id plus one, 0 for nobody (anything that is not a whole id from 0). */
const entityWire = (id: number): number => (Number.isSafeInteger(id) && id >= 0 ? id + 1 : 0);

/** A key's wire form: a whole number from 0, anything else as 0. */
const keyWire = (key: number): number => (Number.isSafeInteger(key) && key >= 0 ? key : 0);

/**
 * The wire forms of the params of the event being encoded, by slot: worked out once while the mask is built and read
 * back as they are written. Shared by every encode, which nothing interrupts between the two passes.
 */
const WIRE = new Float64Array(64);

/** Works out a param's wire form into `WIRE` and returns whether it differs from its default's, so it crosses. */
const quantiseParam = (field: CueField, event: CueEvent, wireDefaults: Float64Array): boolean => {
  const { kind, slot, scale } = field;
  const { values } = event;

  if (kind === VEC2_LIST) {
    return (values[slot + 1] ?? 0) > 0;
  }

  const wire = quantise(kind, scale, values[slot] ?? 0);

  WIRE[slot] = wire;

  if (kind !== VEC2) {
    return wire !== wireDefaults[slot];
  }

  const z = quantise(kind, scale, values[slot + 1] ?? 0);

  WIRE[slot + 1] = z;

  return wire !== wireDefaults[slot] || z !== wireDefaults[slot + 1];
};

/** Writes a list of points: its count, then each point's step from the one before (the first from the origin). */
const writePath = (field: CueField, event: CueEvent, out: CueWriter): void => {
  const start = event.values[field.slot] ?? 0;
  const count = event.values[field.slot + 1] ?? 0;
  let x = 0;
  let z = 0;

  out.uint(count);

  for (let i = 0; i < count; i++) {
    const qx = quantise(VEC2_LIST, field.scale, event.path[start + i * 2] ?? 0);
    const qz = quantise(VEC2_LIST, field.scale, event.path[start + i * 2 + 1] ?? 0);

    out.int(qx - x);
    out.int(qz - z);
    x = qx;
    z = qz;
  }
};

/** Writes one param that crosses, from its wire form in `WIRE`. */
const writeParam = (field: CueField, event: CueEvent, out: CueWriter): void => {
  const { kind, slot } = field;
  const wire = WIRE[slot] ?? 0;

  if (kind === VEC2_LIST) {
    writePath(field, event, out);
  } else if (kind === VEC2) {
    out.int(wire);
    out.int(WIRE[slot + 1] ?? 0);
  } else if (kind === F32) {
    out.f32(wire);
  } else if (kind === FIXED || kind === INT) {
    out.int(wire);
  } else {
    out.uint(wire + (kind === ENTITY ? 1 : 0));
  }
};

/**
 * Writes an event's params (only params that differ from the cue's declared defaults cross): a presence mask
 * (bit `i` for the cue's `i`th param), then each present param in declaration order, quantised by its kind. The part a
 * game embeds in its own event layout when it writes the rest itself.
 */
export const encodeCueParams = (registry: CueRegistry, event: CueEvent, out: CueWriter): void => {
  const schema = registry.schemas[event.cue] ?? corrupt(`names cue ${event.cue}, which is not live`);

  const { fields, wireDefaults } = schema;
  let mask = 0;

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];

    if (field !== undefined && quantiseParam(field, event, wireDefaults)) {
      mask |= 1 << i;
    }
  }

  out.uint(mask);

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];

    if (field !== undefined && (mask & (1 << i)) !== 0) {
      writeParam(field, event, out);
    }
  }
};

/**
 * Writes one event: its cue id, its owner (not for a `world` cue), its entity (only for an `entity` cue), its point at
 * the registry's position scale, its key (only for a predicted cue), then its params (`encodeCueParams`).
 */
export const encodeCue = (registry: CueRegistry, event: CueEvent, out: CueWriter): void => {
  const anchor = registry.columns.anchor[event.cue];

  out.uint(event.cue);

  if (anchor !== WORLD) {
    out.uint(entityWire(event.owner));
  }

  if (anchor === ON_ENTITY) {
    out.uint(entityWire(event.entity));
  }

  out.int(quantise(FIXED, registry.positionScale, event.x));
  out.int(quantise(FIXED, registry.positionScale, event.z));

  if (registry.columns.isPredicted[event.cue] === 1) {
    out.uint(keyWire(event.key));
  }

  encodeCueParams(registry, event, out);
};

/**
 * Writes a buffer's events in firing order: their count, then each (`encodeCue`). `admit`, when given, picks the events
 * one recipient receives (the server's routing, `cueReaches`); it is called twice per event, so it must be pure.
 * Returns how many were written.
 */
export const encodeCues = (buffer: CueBuffer, out: CueWriter, admit?: (event: CueEvent) => boolean): number => {
  const { events, count, registry } = buffer;
  let admitted = admit === undefined ? count : 0;

  for (let i = 0; admit !== undefined && i < count; i++) {
    const event = events[i];

    if (event !== undefined && (admit === undefined || admit(event))) {
      admitted += 1;
    }
  }

  out.uint(admitted);

  for (let i = 0; i < count; i++) {
    const event = events[i];

    if (event !== undefined && (admit === undefined || admit(event))) {
      encodeCue(registry, event, out);
    }
  }

  return admitted;
};

/** Reads a list of points into an event's path. */
const readPath = (field: CueField, event: CueEvent, from: CueReader): void => {
  const count = from.uint();

  if (count * 2 > from.remaining()) {
    corrupt(`claims ${count} points it does not hold`);
  }

  const record = cueRecordOf(event);
  const start = record.reservePath(count * 2);
  let x = 0;
  let z = 0;

  for (let i = 0; i < count; i++) {
    x += from.int();
    z += from.int();
    record.path[start + i * 2] = dequantise(VEC2_LIST, field.scale, x);
    record.path[start + i * 2 + 1] = dequantise(VEC2_LIST, field.scale, z);
  }

  record.values[field.slot] = start;
  record.values[field.slot + 1] = count;
};

/** Reads one param that crossed into its slots. */
const readParam = (field: CueField, event: CueEvent, from: CueReader): void => {
  const { kind, slot, scale } = field;
  const { values } = event;

  if (kind === VEC2_LIST) {
    readPath(field, event, from);
  } else if (kind === VEC2) {
    values[slot] = dequantise(kind, scale, from.int());
    values[slot + 1] = dequantise(kind, scale, from.int());
  } else if (kind === F32) {
    values[slot] = from.f32();
  } else if (kind === FIXED || kind === INT) {
    values[slot] = dequantise(kind, scale, from.int());
  } else {
    values[slot] = dequantise(kind, scale, from.uint() - (kind === ENTITY ? 1 : 0));
  }
};

/** Reads an event's params (`encodeCueParams`'s output) into it; the params that did not cross keep their defaults. */
export const decodeCueParams = (registry: CueRegistry, event: CueEvent, from: CueReader): void => {
  const schema = registry.schemas[event.cue] ?? corrupt(`names cue ${event.cue}, which is not live`);

  const { fields } = schema;
  const mask = from.uint();

  if (mask >= 2 ** fields.length) {
    corrupt(`marks params cue ${registry.name(event.cue)} does not have`);
  }

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];

    if (field !== undefined && (mask & (1 << i)) !== 0) {
      readParam(field, event, from);
    }
  }
};

/** Reads one event (`encodeCue`'s output) into a buffer, appended in order, and returns it. */
export const decodeCue = (from: CueReader, into: CueBuffer): CueEvent => {
  const { registry } = into;
  const cue = toCueId(from.uint());

  if (registry.schemas[cue] === undefined) {
    corrupt(`names cue ${cue}, which is not live`);
  }

  const event = into.emit(cue);
  const anchor = registry.columns.anchor[cue];

  event.owner = anchor === WORLD ? NO_ENTITY : from.uint() - 1;

  if (anchor === SELF) {
    event.entity = event.owner;
  } else if (anchor === ON_ENTITY) {
    event.entity = from.uint() - 1;
  }

  event.x = dequantise(FIXED, registry.positionScale, from.int());
  event.z = dequantise(FIXED, registry.positionScale, from.int());
  event.key = registry.columns.isPredicted[cue] === 1 ? from.uint() : 0;
  decodeCueParams(registry, event, from);

  return event;
};

/** Reads a batch (`encodeCues`'s output) into a buffer, appended in order, and returns how many events it held. */
export const decodeCues = (from: CueReader, into: CueBuffer): number => {
  const count = from.uint();

  if (count > from.remaining()) {
    corrupt(`claims ${count} events it does not hold`);
  }

  for (let i = 0; i < count; i++) {
    decodeCue(from, into);
  }

  return count;
};
