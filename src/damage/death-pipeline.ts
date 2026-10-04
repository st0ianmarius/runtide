import { NO_SOURCE } from '../auras/index.ts';
import type { EventKind } from '../core/index.ts';
import type { DamageTypes } from './damage-types.ts';
import type { DeathRecord, DeathSpec } from './death.ts';
import type { DamageEngine } from './engine.ts';
import type { DeathEvent } from './events.ts';
import type { DeathStep } from './options.ts';
import { firstError } from './stage-order.ts';

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

/**
 * Throws what a run of death parts collected: nothing for none, the error itself for one, and for more the first with
 * the later ones suppressed into it (`firstError`), so a later one (a listener's) never masks it.
 */
const throwCollected = (errors: readonly unknown[] | undefined): void => {
  if (errors !== undefined) {
    throw firstError(errors);
  }
};

/** Runs one reward slot's steps in order: one that throws still has the rest run, then the first error is thrown. */
const runSteps = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  steps: readonly DeathStep<G>[] | undefined,
  death: DeathRecord<G>
): void => {
  if (steps === undefined) {
    return;
  }

  let errors: unknown[] | undefined;

  for (const step of steps) {
    try {
      step(death, engine.system);
    } catch (error) {
      (errors ??= []).push(error);
    }
  }

  throwCollected(errors);
};

/** One part of a death, in the order a death runs them. */
type DeathPhase = <G extends DamageTypes>(engine: DamageEngine<G>, death: DeathRecord<G>) => void;

/** A death's parts: its cue, the rewards before, the `death` and `kill` events, the rewards after, the removal. */
const DEATH_PHASES: readonly DeathPhase[] = [
  (engine, death) => {
    const cues = engine.options.cues;

    cues?.death?.(death, cues.out);
  },
  (engine, death) => {
    runSteps(engine, engine.options.death?.before, death);
  },
  (engine, death) => {
    raiseDeath(engine, engine.options.events?.death, death);
  },
  (engine, death) => {
    if (death.killer !== undefined || death.source !== NO_SOURCE) {
      raiseDeath(engine, engine.options.events?.kill, death);
    }
  },
  (engine, death) => {
    runSteps(engine, engine.options.death?.after, death);
  },
  (engine, death) => {
    engine.host.remove?.(death.unit, death);
  }
];

/**
 * Runs a death's parts in order: one that throws (a reward step, a listener) still has the rest run, so the unit is
 * always taken out and never left alive at no health; then the first error is thrown, later ones attached to it.
 */
const runPhases = <G extends DamageTypes>(engine: DamageEngine<G>, death: DeathRecord<G>): void => {
  let errors: unknown[] | undefined;

  for (const phase of DEATH_PHASES) {
    try {
      phase(engine, death);
    } catch (error) {
      (errors ??= []).push(error);
    }
  }

  throwCollected(errors);
};

/**
 * The death pipeline: the rewards before the death event (souls), the `death` event about the unit and the
 * `kill` event about its killer (raised when the death has a killer or a credited source), the rewards after them (a
 * loot roll), and last the host takes the unit out: a unit system kills it, whose auras hear the `dead` state then (a
 * death burst is an aura's `onState`). Every unit dies the same way: a game whose objective or wall gives no reward
 * reads its class in its reward steps, and a downed hero is a death too (lifecycle `dead`, revivable, every leave-life
 * cleanup run), whose rewards the game's steps gate by the hero's class. A game that wants the unit in a state of its
 * own before any reward (`dying`) enters it from a `death.before` step (`auras.enterState(unit, 'dying')`, a state the
 * game declares); rewards and the `kill` event settle before the `dead` state's `onState` bursts, which is intended. A
 * despawn is not a death and never comes here. What a death sets off nests from it afresh (`maxDepth`), up to
 * `maxKillChain` deaths. `DamageSystem.kill` runs it for a unit outright, whatever its health. While it runs the unit
 * counts gone (`DamageEngine.dying`): a kill, blow, heal, force or `setHealth` on it from inside its own death (a soul
 * link's step, a lethal proc) is refused, so a death never runs twice.
 */
export const runDeath = <G extends DamageTypes>(engine: DamageEngine<G>, spec: DeathSpec<G>): void => {
  const death = engine.deathRecord(spec.unit);
  const { base } = engine;
  const procs = engine.host.procs;
  const procBase = procs?.rebase() ?? 0;

  death.reset(spec);
  engine.depth += 1;
  engine.chain += 1;
  engine.base = engine.depth;
  engine.dying.push(spec.unit);

  try {
    runPhases(engine, death);
  } finally {
    engine.dying.pop();
    procs?.restoreBase(procBase);
    engine.base = base;
    engine.chain -= 1;
    engine.depth -= 1;
  }
};
