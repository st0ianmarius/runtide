import type { AuraApplication, AuraId } from '../auras/index.ts';
import { NO_SOURCE } from '../auras/index.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaAura } from './delivery-def.ts';

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
