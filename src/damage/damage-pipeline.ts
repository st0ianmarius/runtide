import type { EventKind } from '../core/index.ts';
import {
  type BlowWalks,
  type BuiltInStage,
  createBlowWalks,
  healthStageOf,
  lethalStage,
  mitigationStage,
  outgoingStage,
  rollStage
} from './blow-stages.ts';
import type { Blow, BlowRecord, BlowSpec } from './blow.ts';
import { checkBlowSpec } from './check-blow.ts';
import { isNamed } from './compile.ts';
import type { BlowStop, DamageTypes } from './damage-types.ts';
import type { DeathSpec } from './death.ts';
import type { DamageEngine } from './engine.ts';
import type { DamageEvent } from './events.ts';
import { firstError, runBoth } from './stage-order.ts';

/** What the damage pipeline's after-stages hand on to: the death pipeline. */
export interface Onward<G extends DamageTypes> {
  /** The death pipeline, for a blow that killed. */
  readonly death: (spec: DeathSpec<G>) => void;
}

/** A death spec, reused for every blow that kills, since the death pipeline copies it at once. */
class KillSpec<G extends DamageTypes> implements DeathSpec<G> {
  unit: G['bearer'];
  killer: G['bearer'] | undefined = undefined;
  source = 0;
  spell: G['spell'] | undefined = undefined;
  blow: Blow<G> | undefined = undefined;

  constructor(unit: G['bearer']) {
    this.unit = unit;
  }
}

/** Raises a damage event of one kind, if it is heard, and lets go of the blow once the listeners are done. */
const raiseBlow = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  kind: EventKind<DamageEvent<G>> | undefined,
  blow: BlowRecord<G>
): void => {
  const bus = engine.options.events?.bus;

  if (bus === undefined || kind === undefined || !bus.hears(kind)) {
    return;
  }

  const payload = bus.payload(kind);

  payload.blow = blow;
  bus.raise(kind, payload);
  payload.blow = undefined;
};

/** The after-stages: the attacker's `onDealt` hooks, the events and the death pipeline. */
const afterStages = <G extends DamageTypes>(engine: DamageEngine<G>, walks: BlowWalks<G>, onward: Onward<G>) => {
  let kill: KillSpec<G> | undefined;
  const { events } = engine.options;

  const isDealt = (blow: BlowRecord<G>): boolean => blow.status === 'landed' || blow.status === 'absorbed';

  const cue = (blow: BlowRecord<G>): void => {
    const cues = engine.options.cues;

    cues?.blow?.(blow, cues.out);
  };

  const raise = (blow: BlowRecord<G>): void => {
    if (blow.status === 'ignored') {
      raiseBlow(engine, events?.ignored, blow);
    } else {
      raiseBlow(engine, blow.attacker === undefined ? undefined : events?.dealt, blow);
      raiseBlow(engine, events?.taken, blow);
    }
  };

  return {
    dealt: (blow: BlowRecord<G>) => {
      if (isDealt(blow)) {
        engine.eachHook(walks.dealt, blow);
      }

      return undefined;
    },

    // A cue that throws still has the blow's events raised.
    outcome: (blow: BlowRecord<G>) => {
      runBoth(blow, cue, raise);

      return undefined;
    },

    death: (blow: BlowRecord<G>) => {
      if (blow.hasKilled) {
        kill ??= new KillSpec<G>(blow.target);
        kill.unit = blow.target;
        kill.killer = blow.attacker;
        kill.source = blow.source;
        kill.spell = blow.spell;
        kill.blow = blow;
        onward.death(kill);
      }

      return undefined;
    }
  };
};

/** The built-in blow stages that walk hooks, and the ones that do not, by name. */
const builtInStages = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  onward: Onward<G>
): Readonly<Record<string, BuiltInStage<G>>> => {
  const walks = createBlowWalks(engine);
  const after = afterStages(engine, walks, onward);

  return {
    ignore: (_engine, blow) => (engine.eachHook(walks.ignore, blow) ? 'ignored' : undefined),
    outgoing: outgoingStage(engine, walks),
    roll: rollStage,
    ...Object.fromEntries(engine.rows.map((row) => [`mitigation.${row.key}`, mitigationStage<G>(row)])),

    absorb: (_engine, blow) => {
      if (blow.amount > 0) {
        engine.eachHook(walks.absorb, blow);
      }

      return undefined;
    },

    lethal: lethalStage(walks),
    health: healthStageOf(engine, walks),

    dealt: (_engine, blow) => {
      after.dealt(blow);
    },

    outcome: (_engine, blow) => {
      after.outcome(blow);
    },

    death: (_engine, blow) => {
      after.death(blow);
    }
  };
};

/** The stages of one system's damage pipeline, in order. */
const compileDamageRuns = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  onward: Onward<G>
): readonly BuiltInStage<G>[] => {
  const builtIn = builtInStages(engine, onward);

  return engine.order.names.map((name, index): BuiltInStage<G> => {
    const run = engine.order.runs[index];

    if (run !== undefined) {
      return (_engine, blow) => engine.damageStage(run, blow);
    }

    return builtIn[name] ?? ((): undefined => undefined);
  });
};

/** Records one stage of a traced blow. */
const traceStep = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>, index: number): void => {
  blow.trace?.push({
    stage: engine.order.names[index] ?? '',
    amount: blow.amount,
    status: blow.status
  });
};

/** Whether a blow names a stage to skip, or a group it belongs to. */
const blowSkips = (bypass: readonly string[], stage: string): boolean => {
  for (const name of bypass) {
    if (isNamed(stage, name)) {
      return true;
    }
  }

  return false;
};

/** Whether a blow skips the stage at `index`: its kind does, or the blow names it (or its group). */
const skipsStage = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>, index: number): boolean =>
  engine.bypass[blow.kind * engine.order.names.length + index] === 1 ||
  (blow.bypass.length > 0 && blowSkips(blow.bypass, engine.order.names[index] ?? ''));

/**
 * Runs a blow's stages, skipping those its kind or itself bypasses, until one ends it; then every after-stage. A target
 * that died of something else while the blow ran (a nested blow) ends it `skipped`, with no after-stages.
 */
const runBlowStages = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  runs: readonly BuiltInStage<G>[],
  blow: BlowRecord<G>
): void => {
  const { afterFrom } = engine.order;

  for (let i = 0; i < afterFrom; i++) {
    // A hook's nested blow (or a game stage) killed the target: the rest of this blow never happened.
    if (i > 0 && !blow.hasKilled && engine.isDeadNow(blow.target)) {
      blow.status = 'skipped';
      blow.amount = 0;

      return;
    }

    const stop: BlowStop | undefined = skipsStage(engine, blow, i) ? undefined : runs[i]?.(engine, blow);

    if (stop !== undefined) {
      blow.status = stop;
      blow.amount = 0;
    }

    traceStep(engine, blow, i);

    if (stop !== undefined) {
      break;
    }
  }

  // The blow happened: it is known before anything its after-stages set off (a lifesteal heal, an on-hit proc).
  raiseBlow(engine, engine.options.events?.resolved, blow);
  runAfter(engine, runs, blow, afterFrom);
};

/**
 * Runs a blow's after-stages from `start`: one that throws (a hook, a listener) still has the rest run, so a blow that
 * killed always reaches the death pipeline and never leaves its target alive at no health; then the first error is
 * thrown, any later ones suppressed into it (`firstError`).
 */
const runAfter = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  runs: readonly BuiltInStage<G>[],
  blow: BlowRecord<G>,
  start: number
): void => {
  let errors: unknown[] | undefined;

  for (let i = start; i < runs.length; i++) {
    try {
      runs[i]?.(engine, blow);
    } catch (error) {
      (errors ??= []).push(error);
      continue;
    }

    traceStep(engine, blow, i);
  }

  if (errors !== undefined) {
    throw firstError(errors);
  }
};

/**
 * Builds the damage pipeline: a blow on a living target with an amount above 0 runs the stages in their
 * documented order, with the game's at their positions and the ones its kind bypasses skipped, until a stage ends it
 * (`ignored`, `blocked`); then every after-stage runs. A blow of no amount, an infinite one, on a dead target, or
 * nested too deep is `skipped` and runs nothing. A spec that skips an outcome row the roll table lacks, or bypasses a
 * stage that is not one before `health`, throws before anything runs.
 */
export const createDamagePipeline = <G extends DamageTypes>(engine: DamageEngine<G>, onward: Onward<G>) => {
  const runs = compileDamageRuns(engine, onward);

  return (spec: BlowSpec<G>): Blow<G> => {
    checkBlowSpec(engine, spec);

    const blow = engine.blowRecord(spec.target);

    blow.reset(spec, engine.sourceOf(spec.source, spec.attacker), engine.defaultKind);
    blow.depth = engine.depth;

    if (!(spec.amount > 0) || !Number.isFinite(spec.amount) || engine.isDeadNow(spec.target) || !engine.enter()) {
      blow.status = 'skipped';
      blow.amount = 0;

      return blow;
    }

    try {
      runBlowStages(engine, runs, blow);
    } finally {
      engine.leave();
    }

    return blow;
  };
};
