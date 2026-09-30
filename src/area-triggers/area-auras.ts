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
 * so it allocates nothing and touches only the units that entered or left.
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

  /** The walk's place in the units inside, and in the catch (fields, so a walk step allocates nothing). */
  cursor = 0;
  at = 0;

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
 * the last one the unit leaves takes it off.
 */
export class AuraHolds<Unit> {
  readonly #holds = new Map<Unit, Map<number, number>>();
  #application: AreaAuraApplication | undefined = undefined;

  /**
   * The reused application, set for an area aura: its own length as a unit enters, or the linger (a refresh to it) as
   * the last hold leaves.
   */
  applicationFor(
    aura: AuraId,
    spec: Pick<AreaAura<AreaTriggerTypes>, 'stacks' | 'value'>,
    [source, duration]: readonly [number, number | undefined]
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

  /** Counts one fewer hold of an aura on a unit; true when it was the last. */
  drop(unit: Unit, aura: number): boolean {
    const byAura = this.#holds.get(unit);
    const count = byAura?.get(aura) ?? 0;

    if (count <= 1) {
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
    engine.auras.apply(unit, engine.auraHolds.applicationFor(aura, spec, [area.source, undefined]));
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
    engine.auras.apply(unit, engine.auraHolds.applicationFor(aura, spec, [area.source, spec.linger]));
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
  let written = 0;

  inside.cursor = 0;
  inside.isComparing = true;

  try {
    for (let j = 0; j < targets.length && !area.isEnding; j++) {
      const unit = targets[j];

      inside.at = j;

      if (unit !== undefined && !visit(engine, inside, unit)) {
        break;
      }

      written = j + 1;
    }

    for (; inside.cursor < inside.count && !area.isEnding; inside.cursor++) {
      leave(engine, inside, units[inside.cursor]);
    }
  } finally {
    inside.isComparing = false;
  }

  if (area.isEnding) {
    for (let i = inside.cursor; i < inside.count; i++) {
      leave(engine, inside, units[i]);
    }

    for (let k = 0; k < written; k++) {
      leave(engine, inside, nextUnits[k]);
    }

    inside.swap(0);

    return;
  }

  inside.swap(written);
};

/**
 * Visits the catch's entry `inside.at`: the units inside before it leave, it enters unless it was inside, and it is
 * written to the spare lists. False when a hook ended the area trigger.
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

  if (inside.cursor < inside.count && inside.ids[inside.cursor] === id) {
    inside.cursor += 1;
  } else {
    enter(engine, inside, unit);
  }

  inside.nextUnits[inside.at] = unit;
  inside.nextIds[inside.at] = id;

  return true;
};

/** Leaves every unit inside from the cursor whose id is below `id`, stopping if the area trigger ends. */
const walkTo = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, inside: AuraInside<G>, id: number): void => {
  while (inside.cursor < inside.count && (inside.ids[inside.cursor] ?? 0) < id && !inside.area.isEnding) {
    leave(engine, inside, inside.units[inside.cursor]);
    inside.cursor += 1;
  }
};

/** Runs one area aura for a frame: the units caught now enter, the ones gone leave. */
const stepAura = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, index: number): void => {
  const spec = engine.registry.get(area.kind).auras?.[index];
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

/** Takes an area trigger's enter-exit auras off the units still inside as it ends. */
export const dropAreaAuras = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const count = engine.registry.get(area.kind).auras?.length ?? 0;

  for (let index = 0; index < count; index++) {
    const inside = area.insideOf(index);

    // A walk comparing it drops its units itself once it sees the end.
    if (inside.isComparing) {
      continue;
    }

    for (let i = 0; i < inside.count; i++) {
      leave(engine, inside, inside.units[i]);
    }

    inside.swap(0);
  }
};
