import { NO_SOURCE } from '../auras/index.ts';
import type { Blow } from './blow.ts';
import type { DamageTypes } from './damage-types.ts';

/**
 * A death as the death pipeline's steps, its events and the host see it (§II.6 D5). It is reused per nesting level,
 * so nothing keeps it past the call that handed it over.
 */
export interface Death<G extends DamageTypes> {
  /** Who died. */
  readonly unit: G['bearer'];

  /** Who dealt the killing blow, if anyone. */
  readonly killer: G['bearer'] | undefined;

  /** The entity id the kill is credited to. */
  readonly source: number;

  /** The spell the killing blow came from, if any. */
  readonly spell: G['spell'] | undefined;

  /** The killing blow, when a blow killed (not a `setHealth`). */
  readonly blow: Blow<G> | undefined;

  /** Whether the unit is inert (an objective, a wall): its death runs no rewards and raises no death or kill event. */
  readonly isInert: boolean;
}

/** What a death is started from. */
export interface DeathSpec<G extends DamageTypes> {
  /** Who died. */
  readonly unit: G['bearer'];

  /** Who killed it. */
  readonly killer: G['bearer'] | undefined;

  /** The credited entity id. */
  readonly source: number;

  /** The spell. */
  readonly spell: G['spell'] | undefined;

  /** The killing blow. */
  readonly blow: Blow<G> | undefined;
}

/** The mutable record behind a `Death`, one per nesting level. */
export class DeathRecord<G extends DamageTypes> implements Death<G> {
  unit: G['bearer'];
  killer: G['bearer'] | undefined = undefined;
  source = NO_SOURCE;
  spell: G['spell'] | undefined = undefined;
  blow: Blow<G> | undefined = undefined;
  isInert = false;

  constructor(unit: G['bearer']) {
    this.unit = unit;
  }

  /** Fills the record from a spec. */
  reset(spec: DeathSpec<G>, isInert: boolean): void {
    this.unit = spec.unit;
    this.killer = spec.killer;
    this.source = spec.source;
    this.spell = spec.spell;
    this.blow = spec.blow;
    this.isInert = isInert;
  }
}
