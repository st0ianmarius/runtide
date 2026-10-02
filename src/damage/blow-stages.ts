// Hot path: every blow runs these, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { ActiveAura, AuraContext, BlowChange } from '../auras/index.ts';
import type { BlowRecord } from './blow.ts';
import type { BlowStop, DamageTypes } from './damage-types.ts';
import { type DamageEngine, type HookWalk, missing } from './engine.ts';
import { type CompiledRow, nonNegative, rowFactor } from './mitigation.ts';
import { chanceOf, type CompiledRollRow, multiplierOf, ROLL_EFFECTS } from './rolls.ts';

/** A built-in stage of the damage pipeline. */
export type BuiltInStage<G extends DamageTypes> = (
  engine: DamageEngine<G>,
  blow: BlowRecord<G>
) => BlowStop | undefined;

/** The walks the built-in stages take over aura hooks, made once per system. */
export interface BlowWalks<G extends DamageTypes> {
  /** `onIgnore` on the target: true passes the blow by. */
  readonly ignore: HookWalk<G, BlowRecord<G>>;

  /** `onOutgoingDamage` on the attacker. */
  readonly outgoing: HookWalk<G, BlowRecord<G>>;

  /** `onIncomingDamage` on the target, until nothing is left. */
  readonly absorb: HookWalk<G, BlowRecord<G>>;

  /** `onLethal` on the target, until one prevents the death. */
  readonly lethal: HookWalk<G, BlowRecord<G>>;

  /** `onDealt` on the attacker. */
  readonly dealt: HookWalk<G, BlowRecord<G>>;
}

/**
 * What an absorb hook takes, asked for `asked` (at most what is left): an instance that holds a value takes what its
 * value paid, spent from it, so a shield never absorbs more than it holds; one without a value takes all it asked.
 */
export const absorbFrom = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  [bearer, aura]: readonly [G['bearer'], ActiveAura<G>],
  asked: number
): number => {
  if (!(asked > 0)) {
    return 0;
  }

  return aura.value > 0 ? engine.auras.spendValue(bearer, aura, asked) : asked;
};

/**
 * Applies one absorb hook's change: absorb (spending the value of the instance whose hook it was), then scale. Made
 * once per system, so applying a change allocates nothing.
 */
const changeApplier =
  <G extends DamageTypes>(engine: DamageEngine<G>) =>
  (blow: BlowRecord<G>, aura: ActiveAura<G>, change: BlowChange): void => {
    const absorbed = absorbFrom(engine, [blow.target, aura], Math.min(change.absorb ?? 0, blow.amount));

    if (absorbed > 0) {
      blow.amount -= absorbed;
      blow.absorbed += absorbed;
    }

    if (change.scale !== undefined) {
      blow.amount *= nonNegative(change.scale);
    }
  };

/** Prevents a death if a lethal hook says so: the damage is kept back and the hook's procs run. Made once per system. */
const deathPreventer =
  <G extends DamageTypes>(engine: DamageEngine<G>) =>
  (blow: BlowRecord<G>, aura: ActiveAura<G>, ctx: AuraContext<G>): boolean => {
    const outcome = engine.auras.registry.hooks.onLethal[aura.id]?.(ctx, blow);

    if (outcome?.prevent !== true) {
      return false;
    }

    blow.prevented = blow.amount;
    blow.amount = 0;
    blow.isDeathPrevented = true;
    engine.runProcs(outcome.procs, ctx);

    return true;
  };

/** Makes the hook walks of one system. */
export const createBlowWalks = <G extends DamageTypes>(engine: DamageEngine<G>): BlowWalks<G> => {
  const { hooks } = engine.auras.registry;
  const target = (blow: BlowRecord<G>): G['bearer'] => blow.target;
  const attacker = (blow: BlowRecord<G>): G['bearer'] | undefined => blow.attacker;
  const applyChange = changeApplier(engine);
  const { defs } = engine.auras.registry;

  const incomingOrder = defs.some((def) => (def?.incomingOrder ?? 0) !== 0)
    ? Float64Array.from(defs, (def) => def?.incomingOrder ?? 0)
    : undefined;

  return {
    ignore: {
      hook: 'onIgnore',
      unit: target,
      other: attacker,
      step: (blow, aura, ctx) => hooks.onIgnore[aura.id]?.(ctx, blow) === true
    },

    outgoing: {
      hook: 'onOutgoingDamage',
      unit: attacker,
      other: target,

      step: (blow, aura, ctx) => {
        const scale = hooks.onOutgoingDamage[aura.id]?.(ctx, blow)?.scale;

        if (scale !== undefined) {
          blow.amount *= nonNegative(scale);
        }

        return false;
      }
    },

    absorb: {
      hook: 'onIncomingDamage',
      unit: target,
      other: attacker,
      ...(incomingOrder === undefined ? {} : { order: incomingOrder }),

      step: (blow, aura, ctx) => {
        const change = hooks.onIncomingDamage[aura.id]?.(ctx, blow);

        if (change !== undefined) {
          applyChange(blow, aura, change);
          engine.runProcs(change.procs, ctx);
        }

        return blow.amount <= 0;
      }
    },

    lethal: { hook: 'onLethal', unit: target, other: attacker, step: deathPreventer(engine) },

    dealt: {
      hook: 'onDealt',
      unit: attacker,
      other: target,

      step: (blow, aura, ctx) => {
        engine.runProcs(hooks.onDealt[aura.id]?.(ctx, blow), ctx);

        return false;
      }
    }
  };
};

/** The attacker's outgoing multipliers, in order, each at its spell's share. */
const outgoingStats = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): undefined => {
  const stats = engine.stats.outgoing;

  if ((blow.attacker === undefined && blow.attackerStats === undefined) || stats.length === 0) {
    return undefined;
  }

  const view = engine.attackerView(blow);

  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i];

    if (stat !== undefined) {
      blow.amount *= engine.shared(view, stat, blow);
    }
  }

  return undefined;
};

/**
 * The outgoing stage: the attacker's outgoing multipliers, then its auras' `onOutgoingDamage`
 * hooks in list order. A game whose auras have no such hook walks none.
 */
export const outgoingStage = <G extends DamageTypes>(engine: DamageEngine<G>, walks: BlowWalks<G>): BuiltInStage<G> => {
  if (engine.auras.registry.has.onOutgoingDamage.isEmpty()) {
    return outgoingStats;
  }

  return (_engine, blow) => {
    outgoingStats(engine, blow);
    engine.eachHook(walks.outgoing, blow);

    return undefined;
  };
};

/** The effect code of an avoid row. */
const AVOID = ROLL_EFFECTS.indexOf('avoid');

/** The effect code of a block row. */
const BLOCK = ROLL_EFFECTS.indexOf('block');

/** Applies a row a blow rolled: an avoid or a block ends it, a scale multiplies it and it goes on. */
const applyRow = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  blow: BlowRecord<G>,
  row: CompiledRollRow
): BlowStop | undefined => {
  blow.outcome = row.outcome;

  if (row.effect === AVOID) {
    return 'avoided';
  }

  if (row.effect === BLOCK) {
    return 'blocked';
  }

  if (row.multiplier !== undefined) {
    blow.amount *= multiplierOf(row.multiplier, engine.rollViews);
  }

  blow.isCrit ||= row.isCrit;

  return undefined;
};

/** Whether a blow rolls a row: neither its kind's unrolled effects nor its own skips name it. */
const rollsRow = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>, row: CompiledRollRow): boolean =>
  (((engine.unrolled[blow.kind] ?? 0) >> row.effect) & 1) === 0 && !blow.skips.includes(row.outcome);

/** `single` mode: one draw, each row taking its chance of it in order, the first it falls in deciding. */
const rollSingle = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  blow: BlowRecord<G>,
  rows: readonly CompiledRollRow[]
): BlowStop | undefined => {
  let draw = -1;
  let reach = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const chance = row === undefined || !rollsRow(engine, blow, row) ? 0 : chanceOf(row, engine.rollViews);

    if (row !== undefined && chance > 0) {
      draw = draw < 0 ? (engine.host.roll ?? missing('roll'))('table', blow) : draw;
      reach += chance;

      if (draw < reach) {
        return applyRow(engine, blow, row);
      }
    }
  }

  return undefined;
};

/** `independent` mode: each row draws on its own, in order, until an avoid or a block ends the blow. */
const rollIndependent = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  blow: BlowRecord<G>,
  rows: readonly CompiledRollRow[]
): BlowStop | undefined => {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (
      row !== undefined &&
      rollsRow(engine, blow, row) &&
      engine.hits(chanceOf(row, engine.rollViews), row.outcome, blow)
    ) {
      const stop = applyRow(engine, blow, row);

      if (stop !== undefined) {
        return stop;
      }
    }
  }

  return undefined;
};

/**
 * The roll stage: the game's outcome rows, read with the attacker's stats by the blow's
 * spell's shares and the defender's, in the table's mode. A world blow (no attacker) reads empty attacker stats.
 */
export const rollStage = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  blow: BlowRecord<G>
): BlowStop | undefined => {
  const table = engine.rolls;

  if (table === undefined) {
    return undefined;
  }

  const views = engine.rollViews;

  views.shared.view = engine.attackerView(blow);
  views.shared.spell = blow.spell;
  views.target = engine.viewOf(blow.target, blow, blow.attacker);

  const stop =
    table.mode === 'single' ? rollSingle(engine, blow, table.rows) : rollIndependent(engine, blow, table.rows);

  views.shared.spell = undefined;

  return stop;
};

/** One mitigation row's stage: the row, if it covers the blow's kind, over the blow's amount. */
export const mitigationStage =
  <G extends DamageTypes>(row: CompiledRow): BuiltInStage<G> =>
  (engine, blow) => {
    if (row.kinds[blow.kind] !== 1) {
      return undefined;
    }

    const ctx = engine.rowContext;
    const before = blow.amount;

    ctx.caster = engine.attackerView(blow);
    ctx.target = engine.viewOf(blow.target, blow, blow.attacker);
    ctx.amount = before;
    blow.amount = before * rowFactor(row, ctx);
    blow.mitigated += before - blow.amount;

    return undefined;
  };

/** Whether a blow would take its living target to death with what it carries now. */
const isLethal = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): boolean => {
  const health = engine.host.health(blow.target);

  return blow.amount > 0 && !engine.isDead(health, blow.target) && engine.isDead(health - blow.amount, blow.target);
};

/** The lethal stage: a blow that would kill its target has the target's `onLethal` hooks walk, until one prevents it. */
export const lethalStage =
  <G extends DamageTypes>(walks: BlowWalks<G>): BuiltInStage<G> =>
  (engine, blow) => {
    blow.isLethalPending = !isLethal(engine, blow);

    if (!blow.isLethalPending) {
      engine.eachHook(walks.lethal, blow);
    }

    return undefined;
  };

/**
 * The health stage of a system. A game stage between `lethal` and `health` may raise a blow that was not lethal into
 * one that is: the health stage then walks the `onLethal` hooks the lethal stage did not, so no death passes them by.
 * Without such a stage it is `healthStage` alone.
 */
export const healthStageOf = <G extends DamageTypes>(engine: DamageEngine<G>, walks: BlowWalks<G>): BuiltInStage<G> => {
  const { names } = engine.order;

  if (names.indexOf('health') - names.indexOf('lethal') <= 1) {
    return healthStage;
  }

  return (_engine, blow) => {
    if (blow.isLethalPending && isLethal(engine, blow)) {
      blow.isLethalPending = false;
      engine.eachHook(walks.lethal, blow);
    }

    healthStage(engine, blow);

    return undefined;
  };
};

/** Health: the damage left is taken off, and whether it killed is decided by the system's death rule. */
const healthStage = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): undefined => {
  const before = engine.host.health(blow.target);

  blow.healthBefore = before;
  blow.healthAfter = before;

  if (blow.amount > 0) {
    const after = before - blow.amount;

    engine.host.setHealth(blow.target, after);
    blow.healthAfter = after;
    blow.dealt = Math.min(blow.amount, Math.max(0, before));
    blow.overkill = blow.amount - blow.dealt;
    blow.hasKilled = !engine.isDead(before, blow.target) && engine.isDead(after, blow.target);
  }

  if (blow.amount === 0 && blow.absorbed > 0 && !blow.isDeathPrevented) {
    blow.status = 'absorbed';
  }

  return undefined;
};
