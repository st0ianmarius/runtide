import type { AuraId, AuraTagId } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import { explainScaled, type ScaledExplanation, type StatId } from '../modifiers/index.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';
import type { CompiledButton } from './buttons.ts';
import type { AbilityEngine } from './engine.ts';

/** One aura a button lands, as data: the aura and the stat that scales its length. */
export interface ButtonApplyExplanation {
  /** The aura. */
  readonly aura: AuraId;

  /** The stat whose total multiplies its length; `undefined` for its own length. */
  readonly scaledBy: StatId | undefined;
}

/**
 * A button's rules as data (§II.6 M6, §I.5.3), for the client's tooltip: its cooldown explained at a rank, when it
 * starts, its cost, its tags and the auras it lands. Ids, not names or text.
 */
export interface ButtonExplanation {
  /** The discriminant. */
  readonly kind: 'button';

  /**
   * Its cooldown: its seconds, or its scaled value explained at the rank (with the caster's readings and total when a
   * caster was given, ratios only when not); `undefined` for none or a function of the caster.
   */
  readonly cooldown: number | ScaledExplanation | undefined;

  /** Whether its cooldown is a function of the caster, which only a caster can read (`cooldownOf`). */
  readonly isComputed: boolean;

  /** When its cooldown starts. */
  readonly startsOn: 'activation' | 'cast';

  /** Its cost; `undefined` for none. */
  readonly cost:
    | {
        /** The aura spent. */
        readonly aura: AuraId;

        /** The stacks spent. */
        readonly stacks: number;
      }
    | undefined;

  /** The tags the caster must hold. */
  readonly requires: readonly AuraTagId[];

  /** The tags the caster may not hold. */
  readonly blockedBy: readonly AuraTagId[];

  /** The tags whose auras it removes. */
  readonly resets: readonly AuraTagId[];

  /** The auras it lands, in order. */
  readonly applies: readonly ButtonApplyExplanation[];
}

/** A button's cooldown as data: its number, its scaled value explained, or `undefined` for none or a function. */
const explainCooldown = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  [button, spell, rank]: readonly [CompiledButton<G>, SpellId, number],
  caster: G['bearer'] | undefined,
): ButtonExplanation['cooldown'] => {
  const { cooldown } = button;

  if (cooldown === undefined || typeof cooldown === 'number') {
    return cooldown;
  }

  if (typeof cooldown === 'function') {
    return undefined;
  }

  return explainScaled(cooldown, rank, caster === undefined ? undefined : { caster: engine.viewOf(caster, spell) });
};

/**
 * Explains a button spell at a rank (§II.6 M6): with no caster, a preview that needs no world; with one, its cooldown
 * reads the caster's stats for the spell. `undefined` for a spell that is not a button.
 */
export const explainButton = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  [spell, rank]: readonly [SpellId, number],
  caster: G['bearer'] | undefined,
): ButtonExplanation | undefined => {
  const button = engine.buttons[spell];

  if (button === undefined) {
    return undefined;
  }

  return {
    kind: 'button',
    cooldown: explainCooldown(engine, [button, spell, rank], caster),
    isComputed: typeof button.cooldown === 'function',
    startsOn: button.isCastCooldown ? 'cast' : 'activation',
    cost: button.costAura < 0 ? undefined : { aura: toId<'auras'>(button.costAura), stacks: button.costStacks },
    requires: button.requires,
    blockedBy: button.blockedBy,
    resets: button.resets,
    applies: button.applies.map(({ aura, stat }) => ({ aura, scaledBy: stat })),
  };
};
