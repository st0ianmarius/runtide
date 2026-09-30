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

    step: (force, aura, ctx) => {
      const change = hooks.onIncomingForce[aura.id]?.(ctx, force);

      if (change?.isCancelled === true) {
        force.status = 'ignored';

        return true;
      }

      if (change?.scale !== undefined) {
        force.amount *= Math.max(0, change.scale);
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

/**
 * Builds the force pipeline: a knockback, push or pull goes through the target's `onIncomingForce` hooks in
 * list order (a cancel ends it `ignored`, a scale changes its strength) and the game's stages (immunity, a resist
 * factor and cap), then the host moves the unit. A force with no strength, or on a dead unit, is `skipped`.
 */
export const createForcePipeline = <G extends DamageTypes>(engine: DamageEngine<G>) => {
  const runs = compileForceRuns(engine);

  return (spec: ForceSpec<G>): Force<G> => {
    const force = engine.forceRecord(spec.target);

    force.reset(spec, engine.sourceOf(spec.source, spec.attacker));

    if (!(spec.strength > 0) || engine.isDeadNow(spec.target) || !engine.enter()) {
      force.status = 'skipped';
      force.amount = 0;

      return force;
    }

    try {
      const cues = engine.options.cues;

      runForceStages(engine, runs, force);
      cues?.force?.(force, cues.out);
    } finally {
      engine.leave();
    }

    return force;
  };
};
