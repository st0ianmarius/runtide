// Hot path (§I.4.2, §I.5.4): every blow runs these, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { ActiveAura, AuraContext, BlowChange } from '../auras/index.ts';
import type { BlowRecord } from './blow.ts';
import type { BlowStop, DamageTypes } from './damage-types.ts';
import type { DamageEngine, HookWalk } from './engine.ts';
import { mitigate } from './mitigation.ts';

/** A built-in stage of the damage pipeline. */
export type BuiltInStage<G extends DamageTypes> = (
  engine: DamageEngine<G>,
  blow: BlowRecord<G>,
) => BlowStop | undefined;

/** The walks the built-in stages take over aura hooks, made once per system. */
export interface BlowWalks<G extends DamageTypes> {
  /** `onIgnore` on the target: true passes the blow by. */
  readonly ignore: HookWalk<G, BlowRecord<G>>;

  /** `onIncomingDamage` on the target, until nothing is left. */
  readonly absorb: HookWalk<G, BlowRecord<G>>;

  /** `onLethal` on the target, until one prevents the death. */
  readonly lethal: HookWalk<G, BlowRecord<G>>;

  /** `onDealt` on the attacker. */
  readonly dealt: HookWalk<G, BlowRecord<G>>;
}

/**
 * Applies one absorb hook's change: absorb (spending the aura's value), then scale, then the knock veto. Made once per
 * system, so applying a change allocates nothing.
 */
const changeApplier =
  <G extends DamageTypes>(engine: DamageEngine<G>) =>
  (blow: BlowRecord<G>, aura: ActiveAura<G>, change: BlowChange): void => {
    const wanted = change.absorb ?? 0;
    const absorbed = wanted > 0 ? Math.min(wanted, blow.amount) : 0;

    if (absorbed > 0) {
      blow.amount -= absorbed;
      blow.absorbed += absorbed;
      engine.auras.spendValue(blow.target, aura.id, absorbed);
    }

    if (change.scale !== undefined) {
      blow.amount *= Math.max(0, change.scale);
    }

    if (change.knock === 'none') {
      blow.isKnockCancelled = true;
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
  const applyChange = changeApplier(engine);

  return {
    ignore: {
      hook: 'onIgnore',
      unit: target,
      step: (blow, aura, ctx) => hooks.onIgnore[aura.id]?.(ctx, blow) === true,
    },

    absorb: {
      hook: 'onIncomingDamage',
      unit: target,

      step: (blow, aura, ctx) => {
        const change = hooks.onIncomingDamage[aura.id]?.(ctx, blow);

        if (change !== undefined) {
          applyChange(blow, aura, change);
        }

        return blow.amount <= 0;
      },
    },

    lethal: { hook: 'onLethal', unit: target, step: deathPreventer(engine) },

    dealt: {
      hook: 'onDealt',
      unit: (blow) => blow.attacker,

      step: (blow, aura, ctx) => {
        engine.runProcs(hooks.onDealt[aura.id]?.(ctx, blow), ctx);

        return false;
      },
    },
  };
};

/** The attacker's outgoing multipliers, in order, each at its spell's share (§II.3.13). */
export const outgoingStage = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): undefined => {
  const stats = engine.stats.outgoing;

  if (blow.attacker === undefined || stats.length === 0) {
    return undefined;
  }

  const view = engine.viewOf(blow.attacker, blow);

  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i];

    if (stat !== undefined) {
      blow.amount *= engine.shared(view, stat, blow);
    }
  }

  return undefined;
};

/** The attacker's crit: one roll at its chance, then its damage multiplier, each at the spell's share. */
export const critStage = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): undefined => {
  const { critChance, critDamage } = engine.stats;

  if (blow.attacker === undefined || critChance === undefined || critDamage === undefined) {
    return undefined;
  }

  const view = engine.viewOf(blow.attacker, blow);

  if (engine.hits(engine.shared(view, critChance, blow), 'crit', blow)) {
    blow.isCrit = true;
    blow.amount *= engine.shared(view, critDamage, blow);
  }

  return undefined;
};

/** The defender's block: one roll at its chance, unless the blow is unblockable. */
export const blockStage = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  blow: BlowRecord<G>,
): BlowStop | undefined => {
  const chanceStat = engine.stats.blockChance;

  if (chanceStat === undefined || blow.isUnblockable) {
    return undefined;
  }

  const chance = engine.viewOf(blow.target, blow).total(chanceStat);

  return engine.hits(chance, 'block', blow) ? 'blocked' : undefined;
};

/** Crushing: a share of the target's maximum health added to the blow. */
export const crushingStage = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): undefined => {
  if (blow.crushing > 0) {
    blow.amount += blow.crushing * engine.maxHealthOf(blow.target);
  }

  return undefined;
};

/** The mitigation rows that cover the blow's kind, in order (§II.3.14). */
export const mitigationStage = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): undefined => {
  if (engine.rows.length === 0) {
    return undefined;
  }

  const ctx = engine.rowContext;
  const before = blow.amount;

  ctx.caster = engine.viewOf(blow.attacker, blow);
  ctx.target = engine.viewOf(blow.target, blow);
  ctx.amount = before;
  blow.amount = mitigate(engine.rows, blow.kind, ctx);
  blow.mitigated = before - blow.amount;

  return undefined;
};

/** Health: the damage left is taken off, and whether it killed is decided by the system's death rule. */
export const healthStage = <G extends DamageTypes>(engine: DamageEngine<G>, blow: BlowRecord<G>): undefined => {
  const before = engine.host.health(blow.target);

  blow.healthBefore = before;
  blow.healthAfter = before;

  if (blow.amount > 0) {
    const after = before - blow.amount;

    engine.host.setHealth(blow.target, after);
    blow.healthAfter = after;
    blow.dealt = Math.min(blow.amount, Math.max(0, before));
    blow.hasKilled = !engine.isDead(before) && engine.isDead(after);
  }

  if (blow.amount === 0 && blow.absorbed > 0 && !blow.isDeathPrevented) {
    blow.status = 'absorbed';
  }

  return undefined;
};
