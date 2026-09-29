import type { EventKind } from '../core/index.ts';
import type { Vec2 } from '../math/index.ts';
import {
  type BlowWalks,
  type BuiltInStage,
  createBlowWalks,
  crushingStage,
  healthStage,
  mitigationStage,
  outgoingStage,
  rollStage,
} from './blow-stages.ts';
import type { Blow, BlowRecord, BlowSpec } from './blow.ts';
import type { BlowStop, DamageTypes, ForceKind } from './damage-types.ts';
import type { DeathSpec } from './death.ts';
import type { DamageEngine } from './engine.ts';
import type { DamageEvent } from './events.ts';
import type { Force, ForceSpec } from './force.ts';

/** What the damage pipeline's after-stages hand on to: the force and death pipelines. */
export interface Onward<G extends DamageTypes> {
  /** The force pipeline, for a blow's knockback. */
  readonly force: (spec: ForceSpec<G>) => Force<G>;

  /** The death pipeline, for a blow that killed. */
  readonly death: (spec: DeathSpec<G>) => void;
}

/** A knockback spec, reused for every blow that knocks, since the force pipeline copies it at once. */
class KnockSpec<G extends DamageTypes> implements ForceSpec<G> {
  target: G['bearer'];
  strength = 0;
  readonly kind: ForceKind = 'knock';
  attacker: G['bearer'] | undefined = undefined;
  source: number | undefined = undefined;
  from: Vec2 | undefined = undefined;

  constructor(target: G['bearer']) {
    this.target = target;
  }
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
  blow: BlowRecord<G>,
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

/** The after-stages: the attacker's `onDealt` hooks, the events, the knockback and the death pipeline. */
const afterStages = <G extends DamageTypes>(engine: DamageEngine<G>, walks: BlowWalks<G>, onward: Onward<G>) => {
  let knock: KnockSpec<G> | undefined;
  let kill: KillSpec<G> | undefined;
  const events = engine.options.events;
  const isDealt = (blow: BlowRecord<G>): boolean => blow.status === 'landed' || blow.status === 'absorbed';

  return {
    dealt: (blow: BlowRecord<G>) => {
      if (isDealt(blow)) {
        engine.eachHook(walks.dealt, blow);
      }

      return undefined;
    },

    outcome: (blow: BlowRecord<G>) => {
      const cues = engine.options.cues;

      cues?.blow?.(blow, cues.out);

      if (blow.status === 'ignored') {
        raiseBlow(engine, events?.ignored, blow);
      } else {
        raiseBlow(engine, blow.attacker === undefined ? undefined : events?.dealt, blow);
        raiseBlow(engine, events?.taken, blow);
      }

      return undefined;
    },

    knock: (blow: BlowRecord<G>) => {
      if (blow.knock > 0 && !blow.isKnockCancelled && blow.status !== 'blocked') {
        knock ??= new KnockSpec<G>(blow.target);
        knock.target = blow.target;
        knock.strength = blow.knock;
        knock.attacker = blow.attacker;
        knock.source = blow.source;
        knock.from = blow.from;
        onward.force(knock);
      }

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
    },
  };
};

/** The built-in blow stages that walk hooks, and the ones that do not, by name. */
const builtInStages = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  onward: Onward<G>,
): Readonly<Record<string, BuiltInStage<G>>> => {
  const walks = createBlowWalks(engine);
  const after = afterStages(engine, walks, onward);

  return {
    ignore: (_engine, blow) => (engine.eachHook(walks.ignore, blow) ? 'ignored' : undefined),
    outgoing: outgoingStage,
    roll: rollStage,
    crushing: crushingStage,
    mitigation: mitigationStage,

    absorb: (_engine, blow) => {
      if (blow.amount > 0) {
        engine.eachHook(walks.absorb, blow);
      }

      return undefined;
    },

    lethal: (_engine, blow) => {
      const health = engine.host.health(blow.target);

      if (blow.amount > 0 && !engine.isDead(health) && engine.isDead(health - blow.amount)) {
        engine.eachHook(walks.lethal, blow);
      }

      return undefined;
    },

    health: healthStage,

    dealt: (_engine, blow) => {
      after.dealt(blow);
    },

    outcome: (_engine, blow) => {
      after.outcome(blow);
    },

    knock: (_engine, blow) => {
      after.knock(blow);
    },

    death: (_engine, blow) => {
      after.death(blow);
    },
  };
};

/** The stages of one system's damage pipeline, in order. */
const compileDamageRuns = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  onward: Onward<G>,
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
  blow.trace?.push({ stage: engine.order.names[index] ?? '', amount: blow.amount, status: blow.status });
};

/** Runs a blow's stages, skipping those its kind bypasses, until one ends it; then every after-stage. */
const runBlowStages = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  runs: readonly BuiltInStage<G>[],
  blow: BlowRecord<G>,
): void => {
  const { afterFrom } = engine.order;
  const row = blow.kind * runs.length;

  for (let i = 0; i < afterFrom; i++) {
    const stop: BlowStop | undefined = engine.bypass[row + i] === 1 ? undefined : runs[i]?.(engine, blow);

    if (stop !== undefined) {
      blow.status = stop;
      blow.amount = 0;
    }

    traceStep(engine, blow, i);

    if (stop !== undefined) {
      break;
    }
  }

  for (let i = afterFrom; i < runs.length; i++) {
    runs[i]?.(engine, blow);
    traceStep(engine, blow, i);
  }
};

/**
 * Builds the damage pipeline (§II.6 D1, D2): a blow on a living target with an amount above 0 runs the stages in their
 * documented order, with the game's at their positions and the ones its kind bypasses skipped, until a stage ends it
 * (`ignored`, `blocked`); then every after-stage runs. A blow of no amount, on a dead target, or nested too deep is
 * `skipped` and runs nothing.
 */
export const createDamagePipeline = <G extends DamageTypes>(engine: DamageEngine<G>, onward: Onward<G>) => {
  const runs = compileDamageRuns(engine, onward);

  return (spec: BlowSpec<G>): Blow<G> => {
    const blow = engine.blowRecord(spec.target);

    blow.reset(spec, { source: engine.sourceOf(spec.source, spec.attacker), kind: spec.kind ?? engine.defaultKind });

    if (!(spec.amount > 0) || engine.isDeadNow(spec.target) || !engine.enter()) {
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
