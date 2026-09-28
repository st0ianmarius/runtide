import type { AuraApplication, AuraId } from '../auras/index.ts';
import { NO_SOURCE } from '../auras/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaAura } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';
import { catchIn } from './hits.ts';

/** The units inside one of an area trigger's auras: this frame's and the last frame's, swapped each frame. */
export class AuraInside<Unit> {
  /** The units inside as of the last frame. */
  inside = new Set<Unit>();

  /** The units caught this frame, filled then swapped in. */
  next = new Set<Unit>();
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
 * How many enter-exit area auras hold each unit's aura (§II.6 A10), so overlapping area triggers never stack it and
 * the last one the unit leaves takes it off.
 */
export class AuraHolds<Unit> {
  readonly #holds = new Map<Unit, Map<number, number>>();
  #application: AreaAuraApplication | undefined = undefined;

  /** The reused application, set for an area aura. */
  applicationFor(
    aura: AuraId,
    spec: Pick<AreaAura<AreaTriggerTypes>, 'mode' | 'linger' | 'stacks' | 'value'>,
    source: number,
  ): AreaAuraApplication {
    const application = (this.#application ??= new AreaAuraApplication(aura));

    application.aura = aura;
    application.stacks = spec.stacks;
    application.value = spec.value;
    application.source = source;
    application.duration = spec.mode === 'refresh' ? spec.linger : undefined;
    application.stacking = spec.mode === 'refresh' ? 'refresh' : undefined;

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

/** A unit enters an enter-exit area aura: the first hold puts the aura on. */
const enter = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [area, index]: readonly [AreaTrigger<G>, number],
  unit: G['bearer'],
): void => {
  const spec = engine.registry.get(area.kind).auras?.[index];
  const aura = engine.areaAuras[area.kind]?.[index];

  if (spec !== undefined && aura !== undefined && engine.auraHolds.take(unit, aura)) {
    engine.auras.apply(unit, engine.auraHolds.applicationFor(aura, spec, area.source));
  }
};

/** A unit leaves an enter-exit area aura: the last hold takes the aura off. */
const leave = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [area, index]: readonly [AreaTrigger<G>, number],
  unit: G['bearer'],
): void => {
  const aura = engine.areaAuras[area.kind]?.[index];

  if (aura !== undefined && engine.auraHolds.drop(unit, aura)) {
    engine.auras.remove(unit, aura);
  }
};

/** Runs one area aura for a frame: the units caught now enter, the ones gone leave, or every one caught is topped up. */
const stepAura = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, index: number): void => {
  const spec = engine.registry.get(area.kind).auras?.[index];
  const aura = engine.areaAuras[area.kind]?.[index];
  const hit = engine.catcher.take(area, -1);

  try {
    if (spec === undefined || aura === undefined) {
      return;
    }

    catchIn(engine, [{ area, spec, pulse: -1 }, area.shape], hit);

    if (spec.mode === 'refresh') {
      for (const unit of hit.targets) {
        engine.auras.apply(unit, engine.auraHolds.applicationFor(aura, spec, area.source));
      }

      return;
    }

    const sets = area.insideOf(index);

    for (const unit of hit.targets) {
      sets.next.add(unit);

      if (!sets.inside.has(unit)) {
        enter(engine, [area, index], unit);
      }
    }

    for (const unit of sets.inside) {
      if (!sets.next.has(unit)) {
        leave(engine, [area, index], unit);
      }
    }

    [sets.inside, sets.next] = [sets.next, sets.inside];
    sets.next.clear();
  } finally {
    engine.catcher.give(hit);
  }
};

/** Runs an area trigger's auras for a frame (§II.6 A10), in their order. */
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
    const sets = area.insideOf(index);

    for (const unit of sets.inside) {
      leave(engine, [area, index], unit);
    }

    sets.inside.clear();
    sets.next.clear();
  }
};
