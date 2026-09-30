// Hot path (§I.4.2, §I.5.4): every death walks its reward slots, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { EventKind } from '../core/index.ts';
import type { DamageTypes } from './damage-types.ts';
import type { DeathRecord, DeathSpec } from './death.ts';
import type { DamageEngine } from './engine.ts';
import type { DeathEvent } from './events.ts';
import type { DeathStep } from './options.ts';

/** Raises a death event of one kind, if it is heard, and lets go of the death once the listeners are done. */
const raiseDeath = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  kind: EventKind<DeathEvent<G>> | undefined,
  death: DeathRecord<G>,
): void => {
  const bus = engine.options.events?.bus;

  if (bus === undefined || kind === undefined || !bus.hears(kind)) {
    return;
  }

  const payload = bus.payload(kind);

  payload.death = death;
  bus.raise(kind, payload);
  payload.death = undefined;
};

/** Runs one reward slot's steps, in order. */
const runSteps = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  steps: readonly DeathStep<G>[] | undefined,
  death: DeathRecord<G>,
): void => {
  if (steps === undefined) {
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    steps[i]?.(death, engine.system);
  }
};

/**
 * The death pipeline (§II.6 D5): the rewards before the death event (souls), the `death` event about the unit and the
 * `kill` event about its killer, the rewards after them (a loot roll), and last the host takes the unit out: a unit
 * system kills it, whose auras hear the `dead` state then (a death burst is an aura's `onState`). An inert unit (an
 * objective, a wall) runs no rewards and raises no event. A despawn is not a death and never comes here.
 */
export const runDeath = <G extends DamageTypes>(engine: DamageEngine<G>, spec: DeathSpec<G>): void => {
  const death = engine.deathRecord(spec.unit);
  const slots = engine.options.death;
  const events = engine.options.events;

  death.reset(spec, engine.host.isInert?.(spec.unit) ?? false);
  engine.depth += 1;

  try {
    const cues = engine.options.cues;

    cues?.death?.(death, cues.out);

    if (!death.isInert) {
      runSteps(engine, slots?.before, death);
      raiseDeath(engine, events?.death, death);

      if (death.killer !== undefined) {
        raiseDeath(engine, events?.kill, death);
      }

      runSteps(engine, slots?.after, death);
    }

    engine.host.remove?.(spec.unit, death);
  } finally {
    engine.depth -= 1;
  }
};
