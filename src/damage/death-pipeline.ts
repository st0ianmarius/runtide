// Hot path: every death walks its reward slots, so the loops are indexed.
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
  death: DeathRecord<G>
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
  death: DeathRecord<G>
): void => {
  if (steps === undefined) {
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    steps[i]?.(death, engine.system);
  }
};

/**
 * The death pipeline: the rewards before the death event (souls), the `death` event about the unit and the
 * `kill` event about its killer, the rewards after them (a loot roll), and last the host takes the unit out: a unit
 * system kills it, whose auras hear the `dead` state then (a death burst is an aura's `onState`). Every unit dies
 * the same way: a game whose objective or wall gives no reward reads its class in its reward steps. A despawn is not a
 * death and never comes here. What a death sets off nests from it afresh (`maxDepth`), up to `maxKillChain` deaths.
 */
export const runDeath = <G extends DamageTypes>(engine: DamageEngine<G>, spec: DeathSpec<G>): void => {
  const death = engine.deathRecord(spec.unit);
  const slots = engine.options.death;
  const events = engine.options.events;

  const { base } = engine;

  death.reset(spec);
  engine.depth += 1;
  engine.chain += 1;
  engine.base = engine.depth;

  try {
    const cues = engine.options.cues;

    cues?.death?.(death, cues.out);

    runSteps(engine, slots?.before, death);
    raiseDeath(engine, events?.death, death);

    if (death.killer !== undefined) {
      raiseDeath(engine, events?.kill, death);
    }

    runSteps(engine, slots?.after, death);

    engine.host.remove?.(spec.unit, death);
  } finally {
    engine.base = base;
    engine.chain -= 1;
    engine.depth -= 1;
  }
};
