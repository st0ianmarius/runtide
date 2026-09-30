import { NO_SOURCE } from '../auras/index.ts';
import type { ProcOutcome } from '../procs/index.ts';
import type { DamageTypes, HealStatus } from './damage-types.ts';

/** What a caller asks the heal pipeline for: health back for one unit. */
export interface HealSpec<G extends DamageTypes> {
  /** Who is healed. */
  readonly target: G['bearer'];

  /** How much, before any stage; 0, less, NaN or infinite is `skipped`. */
  readonly amount: number;

  /** Who heals, if anyone: its healing-done stat applies. */
  readonly healer?: G['bearer'] | undefined;

  /** The entity id it is credited to; the host's id of the healer, else `NO_SOURCE`, when absent. */
  readonly source?: number | undefined;

  /** The spell it comes from, if any. */
  readonly spell?: G['spell'] | undefined;
}

/**
 * A heal as its stages, events and callers see it. It is reused per nesting level, so nothing keeps it past the call
 * that handed it over. It is a proc outcome too: a heal proc reports it as is.
 */
export interface Heal<G extends DamageTypes> extends ProcOutcome {
  /** Who is healed. */
  readonly target: G['bearer'];

  /** Who heals, if anyone. */
  readonly healer: G['bearer'] | undefined;

  /** The entity id it is credited to. */
  readonly source: number;

  /** The spell it comes from, if any. */
  readonly spell: G['spell'] | undefined;

  /** The amount it was asked for. */
  readonly base: number;

  /** The healing it carries now; once done, the health it gave back (0 when skipped or blocked). */
  readonly amount: number;

  /** What the health stage could not give because the target was full. */
  readonly overheal: number;

  /** How it ended; `landed` while it runs. */
  readonly status: HealStatus;

  /** The target's health when the health stage ran (0 before it). */
  readonly healthBefore: number;

  /** The target's health after it (0 before it). */
  readonly healthAfter: number;
}

/** The mutable record behind a `Heal`, one per nesting level. */
export class HealRecord<G extends DamageTypes> implements Heal<G> {
  target: G['bearer'];
  healer: G['bearer'] | undefined = undefined;
  source = NO_SOURCE;
  spell: G['spell'] | undefined = undefined;
  base = 0;
  amount = 0;
  overheal = 0;
  status: HealStatus = 'landed';
  healthBefore = 0;
  healthAfter = 0;
  readonly hasKilled = false;

  constructor(target: G['bearer']) {
    this.target = target;
  }

  /** Fills the record from a spec. */
  reset(spec: HealSpec<G>, source: number): void {
    this.target = spec.target;
    this.healer = spec.healer;
    this.source = source;
    this.spell = spec.spell;
    this.base = spec.amount;
    this.amount = spec.amount;
    this.overheal = 0;
    this.status = 'landed';
    this.healthBefore = 0;
    this.healthAfter = 0;
  }
}
