import type { DamageTypes } from './damage-types.ts';
import type { DamageEngine } from './engine.ts';
import { createHealWalks, type HealWalks } from './heal-hooks.ts';
import type { Heal, HealRecord, HealSpec } from './heal.ts';

/** One stage of the heal pipeline, built in or the game's. */
type HealRun<G extends DamageTypes> = (heal: HealRecord<G>) => 'blocked' | undefined;

/** Health: the heal is given up to the target's maximum health (when the host knows it). */
const giveHealth = <G extends DamageTypes>(engine: DamageEngine<G>, heal: HealRecord<G>): void => {
  const before = engine.host.health(heal.target);
  const cap = engine.host.maxHealth?.(heal.target) ?? Infinity;
  const after = Math.min(cap, before + heal.amount);

  heal.healthBefore = before;
  heal.healthAfter = before;

  if (after > before) {
    engine.host.setHealth(heal.target, after);
    heal.healthAfter = after;
  }

  const given = heal.healthAfter - before;

  heal.overheal = heal.amount - given;
  heal.amount = given;
};

/** Raises the heal event, if it is heard, and lets go of the heal once the listeners are done. */
const raiseHealed = <G extends DamageTypes>(engine: DamageEngine<G>, heal: HealRecord<G>): void => {
  const events = engine.options.events;
  const kind = events?.healed;

  if (events === undefined || kind === undefined || !events.bus.hears(kind)) {
    return;
  }

  const payload = events.bus.payload(kind);

  payload.heal = heal;
  events.bus.raise(kind, payload);
  payload.heal = undefined;
};

/** A built-in heal stage by name. */
const builtIn = <G extends DamageTypes>(engine: DamageEngine<G>, [name, walks]: readonly [string, HealWalks<G>]) => {
  const { healDone, healReceived } = engine.stats;

  switch (name) {
    case 'outgoing':
    case 'incoming': {
      const walk = walks[name];

      return (heal: HealRecord<G>) => {
        engine.eachHook(walk, heal);

        return undefined;
      };
    }

    case 'done': {
      return (heal: HealRecord<G>) => {
        if (healDone !== undefined && heal.healer !== undefined) {
          heal.amount *= Math.max(0, engine.viewOf(heal.healer, heal).total(healDone));
        }

        return undefined;
      };
    }

    case 'received': {
      return (heal: HealRecord<G>) => {
        if (healReceived !== undefined) {
          heal.amount *= Math.max(0, engine.viewOf(heal.target, heal).total(healReceived));
        }

        return undefined;
      };
    }

    case 'health': {
      return (heal: HealRecord<G>) => {
        giveHealth(engine, heal);

        return undefined;
      };
    }

    default: {
      return (heal: HealRecord<G>) => {
        const cues = engine.options.cues;

        cues?.heal?.(heal, cues.out);
        raiseHealed(engine, heal);

        return undefined;
      };
    }
  }
};

/** The stages of one system's heal pipeline, in order. */
const compileHealRuns = <G extends DamageTypes>(engine: DamageEngine<G>): readonly HealRun<G>[] => {
  const walks = createHealWalks(engine);

  return engine.healOrder.names.map((name, index): HealRun<G> => {
    const run = engine.healOrder.runs[index];

    return run === undefined ? builtIn(engine, [name, walks]) : (heal) => engine.healStage(run, heal);
  });
};

/**
 * Runs a heal's stages: until one blocks it, then the after-stages. A target that died while the heal ran (a hook's
 * blow) ends it `skipped`, with no after-stages, as a blow's does.
 */
const runHealStages = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  runs: readonly HealRun<G>[],
  heal: HealRecord<G>
): void => {
  const { afterFrom } = engine.healOrder;
  let i = 0;

  for (; i < afterFrom; i++) {
    // A hook's blow killed the target: the rest of this heal never happened.
    if (i > 0 && engine.isDeadNow(heal.target)) {
      heal.status = 'skipped';
      heal.overheal = 0;
      heal.amount = 0;

      return;
    }

    if (runs[i]?.(heal) === 'blocked') {
      heal.status = 'blocked';
      heal.overheal = 0;
      heal.amount = 0;
      break;
    }
  }

  for (i = afterFrom; i < runs.length; i++) {
    runs[i]?.(heal);
  }
};

/**
 * Builds the heal pipeline: the healer's healing done and the target's healing received multiply it, the game's
 * stages run at their positions (one may end it `blocked`), and health rises up to the maximum; then the heal event,
 * for a blocked heal too. A heal of no amount, an infinite one, or one on a dead unit is `skipped`. `setHealth` bypasses it.
 */
export const createHealPipeline = <G extends DamageTypes>(engine: DamageEngine<G>) => {
  const runs = compileHealRuns(engine);

  return (spec: HealSpec<G>): Heal<G> => {
    const heal = engine.healRecord(spec.target);

    heal.reset(spec, engine.sourceOf(spec.source, spec.healer));

    if (!(spec.amount > 0) || !Number.isFinite(spec.amount) || engine.isDeadNow(spec.target) || !engine.enter()) {
      heal.status = 'skipped';
      heal.amount = 0;

      return heal;
    }

    try {
      runHealStages(engine, runs, heal);
    } finally {
      engine.leave();
    }

    return heal;
  };
};
