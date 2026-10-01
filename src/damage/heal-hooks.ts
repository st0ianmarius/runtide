import type { ActiveAura, HealChange } from '../auras/index.ts';
import type { DamageTypes } from './damage-types.ts';
import type { DamageEngine, HookWalk } from './engine.ts';
import type { HealRecord } from './heal.ts';

/** The heal pipeline's two hook walks: the healer's `onOutgoingHeal`, the target's `onIncomingHeal`. */
export interface HealWalks<G extends DamageTypes> {
  /** `onOutgoingHeal` on the healer, the target the other unit. */
  readonly outgoing: HookWalk<G, HealRecord<G>>;

  /** `onIncomingHeal` on the target, the healer the other unit. */
  readonly incoming: HookWalk<G, HealRecord<G>>;
}

/**
 * Applies one heal hook's change: absorb (spending the value of the instance whose hook it was, on its bearer: the
 * healer for an outgoing hook), then scale. A heal brought to nothing stops the walk.
 */
const applyChange = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  heal: HealRecord<G>,
  aura: ActiveAura<G>,
  bearer: G['bearer'],
  change: HealChange | undefined
): boolean => {
  const absorbed = Math.min(Math.max(0, change?.absorb ?? 0), heal.amount);

  if (absorbed > 0) {
    heal.amount -= absorbed;
    heal.absorbed += absorbed;
    engine.auras.spendValue(bearer, aura, absorbed);
  }

  if (change?.scale !== undefined) {
    heal.amount *= Math.max(0, change.scale);
  }

  return heal.amount <= 0;
};

/** Makes the heal hook walks of one system. */
export const createHealWalks = <G extends DamageTypes>(engine: DamageEngine<G>): HealWalks<G> => {
  const { hooks } = engine.auras.registry;
  const healer = (heal: HealRecord<G>): G['bearer'] | undefined => heal.healer;
  const target = (heal: HealRecord<G>): G['bearer'] => heal.target;

  return {
    outgoing: {
      hook: 'onOutgoingHeal',
      unit: healer,
      other: target,

      step: (heal, aura, ctx) => applyChange(engine, heal, aura, ctx.bearer, hooks.onOutgoingHeal[aura.id]?.(ctx, heal))
    },

    incoming: {
      hook: 'onIncomingHeal',
      unit: target,
      other: healer,

      step: (heal, aura, ctx) => applyChange(engine, heal, aura, ctx.bearer, hooks.onIncomingHeal[aura.id]?.(ctx, heal))
    }
  };
};
