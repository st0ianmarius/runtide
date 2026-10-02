import type { DamageTypes } from './damage-types.ts';
import { type DamageEngine, type HookWalk, missing } from './engine.ts';
import type { Force, ForceRecord, ForceSpec } from './force.ts';

/** One stage of the force pipeline, built in or the game's. */
type ForceRun<G extends DamageTypes> = (force: ForceRecord<G>) => 'ignored' | undefined;

/** The stages of one system's force pipeline, in order, and where its after-stages start. */
const compileForceRuns = <G extends DamageTypes>(engine: DamageEngine<G>): readonly ForceRun<G>[] => {
  const { hooks } = engine.auras.registry;

  const resist: HookWalk<G, ForceRecord<G>> = {
    hook: 'onIncomingForce',
    unit: (force) => force.target,
    other: (force) => force.attacker,

    step: (force, aura, ctx) => {
      const change = hooks.onIncomingForce[aura.id]?.(ctx, force);

      if (change?.isCancelled === true) {
        force.status = 'ignored';

        return true;
      }

      if (change?.scale !== undefined) {
        // A scale of 0, below or NaN stops the force: it is never handed to the host as NaN.
        force.amount *= change.scale > 0 ? change.scale : 0;
      }

      return false;
    }
  };

  return engine.forceOrder.names.map((name, index): ForceRun<G> => {
    const run = engine.forceOrder.runs[index];

    if (run !== undefined) {
      return (force) => engine.forceStage(run, force);
    }

    if (name === 'resist') {
      return (force) => (engine.eachHook(resist, force) ? 'ignored' : undefined);
    }

    return (force) => {
      (engine.host.applyForce ?? missing('applyForce'))(force);

      return undefined;
    };
  });
};

/** Runs a force's stages: until one cancels it, then the after-stages. */
const runForceStages = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  runs: readonly ForceRun<G>[],
  force: ForceRecord<G>
): void => {
  const { afterFrom } = engine.forceOrder;
  let i = 0;

  for (; i < afterFrom; i++) {
    // A game stage's blow killed the target: the rest of this force never happened, as with a blow or a heal.
    if (i > 0 && engine.isDeadNow(force.target)) {
      force.status = 'skipped';
      force.amount = 0;

      return;
    }

    const stop = runs[i]?.(force);

    if (stop !== undefined) {
      force.status = stop;
      force.amount = 0;
      break;
    }
  }

  for (i = afterFrom; i < runs.length; i++) {
    runs[i]?.(force);
  }
};

/** Raises the `forced` event for a force that ran, if it is heard, and lets go of the force once the listeners are done. */
const raiseForced = <G extends DamageTypes>(engine: DamageEngine<G>, force: ForceRecord<G>): void => {
  const events = engine.options.events;
  const kind = events?.forced;

  if (events === undefined || kind === undefined || !events.bus.hears(kind)) {
    return;
  }

  const payload = events.bus.payload(kind);

  payload.force = force;
  events.bus.raise(kind, payload);
  payload.force = undefined;
};

/**
 * Builds the force pipeline: a knockback, push or pull goes through the target's `onIncomingForce` hooks in
 * list order (each hook's `other` the force's attacker; a cancel ends it `ignored`, a scale changes its strength) and
 * the game's stages (immunity, a resist factor and cap), then the host moves the unit, then the `forced` event is
 * raised (for a landed or an ignored force). A force with no strength, a non-finite one, or on a dead unit is
 * `skipped` and raises nothing.
 */
export const createForcePipeline = <G extends DamageTypes>(engine: DamageEngine<G>) => {
  const runs = compileForceRuns(engine);

  return (spec: ForceSpec<G>): Force<G> => {
    const force = engine.forceRecord(spec.target);

    force.reset(spec, engine.sourceOf(spec.source, spec.attacker));

    if (!(spec.strength > 0) || !Number.isFinite(spec.strength) || engine.isDeadNow(spec.target) || !engine.enter()) {
      force.status = 'skipped';
      force.amount = 0;

      return force;
    }

    try {
      const cues = engine.options.cues;

      runForceStages(engine, runs, force);
      cues?.force?.(force, cues.out);

      if (force.status !== 'skipped') {
        raiseForced(engine, force);
      }
    } finally {
      engine.leave();
    }

    return force;
  };
};
