import type { AuraTagId } from '../auras/index.ts';
import type { DamageTypes } from './damage-types.ts';
import type { DamageEngine } from './engine.ts';
import type { Heal, HealRecord, HealSpec } from './heal.ts';

/** One stage of the heal pipeline, built in or the game's. */
type HealRun<G extends DamageTypes> = (heal: HealRecord<G>) => 'blocked' | undefined;

/** Whether the target holds a heal-block tag. */
const isHealBlocked = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  tags: readonly AuraTagId[],
  heal: HealRecord<G>,
): boolean => tags.some((tag) => engine.auras.hasTag(heal.target, tag));

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

  if (events === undefined || kind === undefined || heal.status !== 'landed' || !events.bus.hears(kind)) {
    return;
  }

  const payload = events.bus.payload(kind);

  payload.heal = heal;
  events.bus.raise(kind, payload);
  payload.heal = undefined;
};

/** A built-in heal stage by name. */
const builtIn = <G extends DamageTypes>(engine: DamageEngine<G>, name: string, tags: readonly AuraTagId[]) => {
  const { healDone, healReceived } = engine.stats;

  switch (name) {
    case 'block': {
      return (heal: HealRecord<G>) => (tags.length > 0 && isHealBlocked(engine, tags, heal) ? 'blocked' : undefined);
    }

    case 'done': {
      return (heal: HealRecord<G>) => {
        if (healDone !== undefined && heal.healer !== undefined) {
          heal.amount *= engine.viewOf(heal.healer, undefined).total(healDone);
        }

        return undefined;
      };
    }

    case 'received': {
      return (heal: HealRecord<G>) => {
        if (healReceived !== undefined) {
          heal.amount *= engine.viewOf(heal.target, undefined).total(healReceived);
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
  const blockTags = engine.stats.healBlock;

  return engine.healOrder.names.map((name, index): HealRun<G> => {
    const run = engine.healOrder.runs[index];

    return run === undefined ? builtIn(engine, name, blockTags) : (heal) => engine.healStage(run, heal);
  });
};

/** Runs a heal's stages: until one blocks it, then the after-stages. */
const runHealStages = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  runs: readonly HealRun<G>[],
  heal: HealRecord<G>,
): void => {
  const { afterFrom } = engine.healOrder;
  let i = 0;

  for (; i < afterFrom; i++) {
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
 * Builds the heal pipeline (§II.6 D3): heal-block tags end a heal `blocked`, the healer's healing done and the target's
 * healing received multiply it, the game's stages run at their positions, and health rises up to the maximum; then the
 * heal event. A heal of no amount, an infinite one, or one on a dead unit is `skipped`. `setHealth` bypasses it.
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
