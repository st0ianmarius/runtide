import type { AuraId, AuraTagId } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';
import type { AbilityEngine } from './engine.ts';

/**
 * A button's rules as data, for the client's tooltip: when it commits, its cost, its tags and the auras it lands. Ids,
 * not names or text; its cooldowns are its spell's (`explainSpell`).
 */
export interface ButtonExplanation {
  /** The discriminant. */
  readonly kind: 'button';

  /** When a press commits: at the press, or once its cast is admitted. */
  readonly commitsOn: 'press' | 'cast';

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
  readonly applies: readonly AuraId[];
}

/** Explains a button spell; `undefined` for a spell that is not a button. */
export const explainButton = <G extends AbilityTypes>(
  engine: AbilityEngine<G>,
  spell: SpellId
): ButtonExplanation | undefined => {
  const button = engine.buttons[spell];

  if (button === undefined) {
    return undefined;
  }

  return {
    kind: 'button',
    commitsOn: button.commitsOnCast ? 'cast' : 'press',
    cost: button.costAura < 0 ? undefined : { aura: toId<'auras'>(button.costAura), stacks: button.costStacks },
    requires: button.requires,
    blockedBy: button.blockedBy,
    resets: button.resets,
    applies: button.applies
  };
};
