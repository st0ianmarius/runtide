import type { AuraApplication, AuraId } from '../auras/index.ts';
import { NO_SOURCE } from '../auras/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaAura } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';
import { catchIn } from './hits.ts';

/**
 * The units inside one of an area trigger's auras as of its last frame, in entity id order with their ids, and the
 * spare lists the next frame is written to before they swap: a frame compares its catch (in id order too) with them,
 * so it allocates nothing and applies or removes the aura only for the units that entered or left, and for a unit
 * still inside whose aura something else took off.
 */
export class AuraInside<G extends AreaTriggerTypes> {
  /** The area trigger record whose aura this is (records are pooled, so it outlives any one instance). */
  readonly area: AreaTrigger<G>;

  /** The aura's index in its kind's `auras`. */
  readonly index: number;

  /** The units inside, valid up to `count`. */
  units: (G['bearer'] | undefined)[] = [];

  /** Their entity ids, ascending. */
  ids: number[] = [];

  /** How many are inside. */
  count = 0;

  /** The lists this frame's units are written to. */
  nextUnits: (G['bearer'] | undefined)[] = [];
  nextIds: number[] = [];

  /** Whether a frame's walk is comparing it now: an end during the walk leaves the dropping to the walk. */
  isComparing = false;

  /**
   * The walk's place in the units inside, and how many of this frame's units it wrote (fields, so a walk step allocates
   * nothing).
   */
  cursor = 0;
  written = 0;

  /** The seconds until its next catch, for an aura that checks every so often; 0 or less when due. */
  wait = 0;

  constructor(area: AreaTrigger<G>, index: number) {
    this.area = area;
    this.index = index;
  }

  /** Makes this frame's lists the current ones, `count` long, and lets go of the old ones' units. */
  swap(count: number): void {
    const { units, ids } = this;

    for (let i = 0; i < this.count; i++) {
      units[i] = undefined;
    }

    this.units = this.nextUnits;
    this.ids = this.nextIds;
    this.nextUnits = units;
    this.nextIds = ids;
    this.count = count;
  }

  /**
   * Hands its units inside to the same aura of the spawn replacing its area trigger, which holds them until its own
   * first catch; true when it did (the spawn's is empty).
   */
  handTo(next: AuraInside<G>): boolean {
    if (next.count > 0) {
      return false;
    }

    const { units, ids } = next;

    next.units = this.units;
    next.ids = this.ids;
    next.count = this.count;
    this.units = units;
    this.ids = ids;
    this.count = 0;
    this.wait = 0;

    return true;
  }

  /** Lets go of every unit as its area trigger ends, so its pooled record starts over. */
  clear(): void {
    this.swap(0);
    this.wait = 0;
  }
}

/** The application an area aura lands with, reused. */
class AreaAuraApplication implements AuraApplication {
  aura: AuraId;
  duration: number | undefined = undefined;
  stacks: number | undefined = undefined;
  value: number | undefined = undefined;
  source = NO_SOURCE;
  stacking: 'refresh' | undefined = undefined;

  constructor(aura: AuraId) {
    this.aura = aura;
  }
}

/**
 * How many enter-exit area auras hold each unit's aura, so overlapping area triggers never stack it and
 * the last one the unit leaves takes it off; and which held auras something else took off, for the next area holding
 * one to put back.
 */
export class AuraHolds<Unit> {
  readonly #holds = new Map<Unit, Map<number, number>>();
  readonly #missing = new Map<Unit, Set<number>>();
  #application: AreaAuraApplication | undefined = undefined;

  /** How many held auras are missing: while none are, a frame asks nothing of the units still inside. */
  missing = 0;

  /**
   * The reused application, set for an area aura: its own length as a unit enters, or the linger (a refresh to it) as
   * the last hold leaves.
   */
  applicationFor(
    aura: AuraId,
    spec: Pick<AreaAura<AreaTriggerTypes>, 'stacks' | 'value'>,
    source: number,
    duration: number | undefined
  ): AreaAuraApplication {
    const application = (this.#application ??= new AreaAuraApplication(aura));

    application.aura = aura;
    application.stacks = spec.stacks;
    application.value = spec.value;
    application.source = source;
    application.duration = duration;
    application.stacking = duration === undefined ? undefined : 'refresh';

    return application;
  }

  /** Counts one more hold of an aura on a unit; true when it was the first. */
  take(unit: Unit, aura: number): boolean {
    let byAura = this.#holds.get(unit);

    if (byAura === undefined) {
      byAura = new Map();
      this.#holds.set(unit, byAura);
    }

    const count = byAura.get(aura) ?? 0;

    byAura.set(aura, count + 1);

    return count === 0;
  }

  /** Notes an aura come off a unit: missing, when an area still holds it there. */
  noteRemoved(unit: Unit, aura: number): void {
    if ((this.#holds.get(unit)?.get(aura) ?? 0) === 0) {
      return;
    }

    let auras = this.#missing.get(unit);

    if (auras === undefined) {
      auras = new Set();
      this.#missing.set(unit, auras);
    }

    if (!auras.has(aura)) {
      auras.add(aura);
      this.missing += 1;
    }
  }

  /** Whether a held aura on a unit is missing. */
  isMissing(unit: Unit, aura: number): boolean {
    return this.missing > 0 && this.#missing.get(unit)?.has(aura) === true;
  }

  /** Forgets that an aura on a unit is missing: it is back, or no area holds it any more. */
  found(unit: Unit, aura: number): void {
    const auras = this.#missing.get(unit);

    if (auras?.delete(aura) !== true) {
      return;
    }

    this.missing -= 1;

    if (auras.size === 0) {
      this.#missing.delete(unit);
    }
  }

  /** Counts one fewer hold of an aura on a unit; true when it was the last. */
  drop(unit: Unit, aura: number): boolean {
    const byAura = this.#holds.get(unit);
    const count = byAura?.get(aura) ?? 0;

    if (count <= 1) {
      this.found(unit, aura);
      byAura?.delete(aura);

      if (byAura?.size === 0) {
        this.#holds.delete(unit);
      }

      return count === 1;
    }

    byAura?.set(aura, count - 1);

    return false;
  }
}

/** A unit enters an area aura: the first hold puts the aura on, for the aura's own length. */
const enter = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, inside: AuraInside<G>, unit: G['bearer']): void => {
  const { area, index } = inside;
  const spec = engine.registry.get(area.kind).auras?.[index];
  const aura = engine.areaAuras[area.kind]?.[index];

  if (spec !== undefined && aura !== undefined && engine.auraHolds.take(unit, aura)) {
    try {
      engine.auras.apply(unit, engine.auraHolds.applicationFor(aura, spec, area.source, undefined));
    } finally {
      if (!engine.auras.has(unit, aura)) {
        engine.auraHolds.noteRemoved(unit, aura);
      }
    }
  }
};

/**
 * A unit still inside: when something else took its aura off (a dispel, a spend, its own length run out, a bearer
 * state), the area puts it back as it would on entry, its hold unchanged, as it keeps its aura on every unit inside;
 * the aura system's removals mark it missing, so no unit is asked about otherwise. Who may hold it is the catch's
 * (the world's targeting rule, the aura's filters) and the host's application policy: one refused stays missing, and
 * is asked again each catch while the unit stays inside.
 */
const restore = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, inside: AuraInside<G>, unit: G['bearer']): void => {
  const { area, index } = inside;
  const { auraHolds, auras } = engine;
  const aura = engine.areaAuras[area.kind]?.[index];

  if (aura === undefined || !auraHolds.isMissing(unit, aura)) {
    return;
  }

  const spec = engine.registry.get(area.kind).auras?.[index];

  if (spec !== undefined && !auras.has(unit, aura)) {
    auras.apply(unit, auraHolds.applicationFor(aura, spec, area.source, undefined));
  }

  if (auras.has(unit, aura)) {
    auraHolds.found(unit, aura);
  }
};

/** A unit leaves an area aura (none for an empty slot): the last hold takes the aura off, or leaves it its linger. */
const leave = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  inside: AuraInside<G>,
  unit: G['bearer'] | undefined
): void => {
  const { area, index } = inside;
  const spec = engine.registry.get(area.kind).auras?.[index];
  const aura = engine.areaAuras[area.kind]?.[index];

  if (unit === undefined || spec === undefined || aura === undefined || !engine.auraHolds.drop(unit, aura)) {
    return;
  }

  if (spec.linger === undefined) {
    engine.auras.remove(unit, aura);
  } else if (engine.auras.has(unit, aura)) {
    engine.auras.apply(unit, engine.auraHolds.applicationFor(aura, spec, area.source, spec.linger));
  }
};

/**
 * Walks this frame's catch (in id order) against the units inside as of the last frame (in id order too): a unit
 * only in the catch enters, one only inside leaves, and this frame's units are written to the spare lists. An
 * enter or leave hook that ends the area trigger stops the walk, and every unit it still holds leaves.
 */
const compare = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  inside: AuraInside<G>,
  targets: readonly G['bearer'][]
): void => {
  const { units, nextUnits, area } = inside;

  inside.cursor = 0;
  inside.written = 0;
  inside.isComparing = true;

  try {
    for (let j = 0; j < targets.length && !area.isEnding; j++) {
      const unit = targets[j];

      if (unit !== undefined && !visit(engine, inside, unit)) {
        break;
      }
    }

    for (; inside.cursor < inside.count && !area.isEnding; inside.cursor++) {
      leave(engine, inside, units[inside.cursor]);
    }
  } catch (error) {
    keepHeld(engine, inside);

    throw error;
  } finally {
    inside.isComparing = false;
  }

  if (area.isEnding) {
    for (let i = inside.cursor; i < inside.count; i++) {
      leave(engine, inside, units[i]);
    }

    for (let k = 0; k < inside.written; k++) {
      leave(engine, inside, nextUnits[k]);
    }

    inside.clear();

    return;
  }

  inside.swap(inside.written);
};

/**
 * A hook threw mid-walk: every unit still held stays inside, this frame's written so far then the old ones not walked
 * yet (in id order still, each after the last written), so a later frame or the end takes their auras off. One the walk
 * left keeps no hold, so its leave then does nothing. A field already ending drops them now, as its end left that to
 * the walk.
 */
const keepHeld = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, inside: AuraInside<G>): void => {
  let written = inside.written;

  for (let i = inside.cursor; i < inside.count; i++) {
    inside.nextUnits[written] = inside.units[i];
    inside.nextIds[written] = inside.ids[i] ?? 0;
    written += 1;
  }

  inside.swap(written);

  if (inside.area.isEnding) {
    for (let i = 0; i < inside.count; i++) {
      leave(engine, inside, inside.units[i]);
    }

    inside.clear();
  }
};

/**
 * Visits a unit of the catch: the units inside before it leave, it is written to the spare lists, and it
 * enters, or has its aura put back when it was inside (written first, so a hook that throws still leaves it held).
 * False when a hook ended the area trigger.
 */
const visit = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  inside: AuraInside<G>,
  unit: G['bearer']
): boolean => {
  const id = engine.world.idOf(unit);

  walkTo(engine, inside, id);

  if (inside.area.isEnding) {
    return false;
  }

  const isInside = inside.cursor < inside.count && inside.ids[inside.cursor] === id;

  inside.nextUnits[inside.written] = unit;
  inside.nextIds[inside.written] = id;
  inside.written += 1;

  if (isInside) {
    inside.cursor += 1;

    if (engine.auraHolds.missing > 0) {
      restore(engine, inside, unit);
    }
  } else {
    enter(engine, inside, unit);
  }

  return true;
};

/** Leaves every unit inside from the cursor whose id is below `id`, stopping if the area trigger ends. */
const walkTo = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, inside: AuraInside<G>, id: number): void => {
  while (inside.cursor < inside.count && (inside.ids[inside.cursor] ?? 0) < id && !inside.area.isEnding) {
    leave(engine, inside, inside.units[inside.cursor]);
    inside.cursor += 1;
  }
};

/** What a wait may be over and still be due: float leftovers of summed frames. */
const CATCH_EPSILON = 1e-9;

/** Counts a periodic aura's wait down by a frame; true when it catches now, its next catch `every` on. */
const isDue = <G extends AreaTriggerTypes>(inside: AuraInside<G>, every: number, frameTime: number): boolean => {
  const isDueNow = inside.wait <= CATCH_EPSILON;

  if (isDueNow) {
    inside.wait += every;
  }

  inside.wait -= frameTime;

  return isDueNow;
};

/** Runs one area aura for a frame: the units caught now enter, the ones gone leave. */
const stepAura = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, index: number): void => {
  const spec = engine.registry.get(area.kind).auras?.[index];

  if (spec?.every !== undefined && !isDue(area.insideOf(index), spec.every, area.frameTime)) {
    return;
  }

  const hit = engine.catcher.take(area, spec, undefined);

  try {
    if (spec !== undefined) {
      catchIn(engine, hit, area.shape);
      compare(engine, area.insideOf(index), hit.targets);
    }
  } finally {
    engine.catcher.give(hit);
  }
};

/** Runs an area trigger's auras for a frame, in their order. */
export const stepAreaAuras = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const count = engine.registry.get(area.kind).auras?.length ?? 0;

  for (let index = 0; index < count && !area.isEnding; index++) {
    stepAura(engine, area, index);
  }
};

/**
 * Takes an area trigger's enter-exit auras off the units still inside as it ends; one ending to make room for a spawn
 * of its kind hands them to it instead, so a recast field keeps its auras on the units in both without a blink, and
 * the spawn's first catch takes them off the ones outside it.
 */
export const dropAreaAuras = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const count = engine.registry.get(area.kind).auras?.length ?? 0;
  const { successor } = area;

  for (let index = 0; index < count; index++) {
    const inside = area.insideOf(index);

    // A walk comparing it drops its units itself once it sees the end.
    if (inside.isComparing || (successor !== undefined && inside.handTo(successor.insideOf(index)))) {
      continue;
    }

    for (let i = 0; i < inside.count; i++) {
      leave(engine, inside, inside.units[i]);
    }

    inside.clear();
  }
};
