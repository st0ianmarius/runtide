import type { Random } from '../core/index.ts';
import { type Activation, isAi, type SpellId, type SpellSystem } from '../spells/index.ts';
import type { AiTypes } from './ai-types.ts';
import { brainOf } from './brain.ts';

/**
 * How a pick is made (§I.7.1 F17, §II.6 C3): every part but the draw is optional, and a game makes one set per kind
 * of brain, once, so a pick allocates nothing.
 */
export interface PickOptions<G extends AiTypes> {
  /** The draw the weighted pick takes (a creature's keyed stream, a horde's shared one). */
  readonly random: Random;

  /** What each candidate is checked with (`spells.check`): its target, an aim. None when absent. */
  readonly input?: G['input'];

  /**
   * A spell's weight for this caster now (distance, hugged, clumped: the game's reading); its activation's `weight`,
   * else 1, when absent. A weight of 0 or less leaves the spell out.
   */
  readonly weight?: (caster: G['bearer'], spell: SpellId) => number;

  /** Whether a spell may be picked now: a budget, a gap the game keeps. Every spell may when absent. */
  readonly allows?: (caster: G['bearer'], spell: SpellId) => boolean;

  /** `avoid` (the default) leaves the last pick out while another spell fits; `allow` does not. */
  readonly repeat?: 'avoid' | 'allow';
}

/** An activation's own weight: an `ai` activation's `weight`, else 1. */
const ownWeight = <G extends AiTypes>(activation: Activation<G>): number =>
  isAi(activation) ? (activation.weight ?? 1) : 1;

/**
 * The one weighted anti-repeat picker (§I.7.1 F17, §II.6 C3): over a pool of spells, each fitting one (a weight above
 * 0, allowed, and one that would start: `spells.check`, so range, sight and the gates are the spell's own) is drawn
 * with a chance in proportion to its weight, the caster's last pick left out while another fits. Deterministic for a
 * given draw; notes the pick on the caster's brain.
 */
export class Picker<G extends AiTypes> {
  readonly #spells: SpellSystem<G>;
  #weights = new Float64Array(8);

  constructor(spells: SpellSystem<G>) {
    this.#spells = spells;
  }

  /** Picks a spell from `pool` for `caster`, or `undefined` when none fits. */
  pick(caster: G['bearer'], pool: readonly SpellId[], options: PickOptions<G>): SpellId | undefined {
    const brain = brainOf(caster.brain);
    const weights = this.#weigh(caster, pool, options);
    let total = 0;
    let fits = 0;

    for (let i = 0; i < pool.length; i++) {
      const weight = weights[i] ?? 0;

      total += weight;
      fits += weight > 0 ? 1 : 0;
    }

    const last = options.repeat === 'allow' || fits < 2 ? -1 : indexOfPick(pool, brain.lastPick);

    if (last >= 0 && (weights[last] ?? 0) > 0) {
      total -= weights[last] ?? 0;
      weights[last] = 0;
    }

    const spell = draw(pool, weights, total * options.random());

    if (spell !== undefined) {
      brain.lastPick = spell;
    }

    return spell;
  }

  /**
   * The first spell of an ordered list that would start now (§II.6 C2: a reaction's forced cast before the picker),
   * allowed when `allows` says so; `undefined` when none would. Does not change the last pick.
   */
  first(
    caster: G['bearer'],
    spells: readonly SpellId[],
    options: Pick<PickOptions<G>, 'input' | 'allows'> = {},
  ): SpellId | undefined {
    for (const spell of spells) {
      if (options.allows?.(caster, spell) !== false && this.#fits(caster, spell, options)) {
        return spell;
      }
    }

    return undefined;
  }

  /** Each candidate's weight, 0 for one that does not fit, into the reused column. */
  #weigh(caster: G['bearer'], pool: readonly SpellId[], options: PickOptions<G>): Float64Array {
    if (this.#weights.length < pool.length) {
      this.#weights = new Float64Array(pool.length * 2);
    }

    const weights = this.#weights;
    const { registry } = this.#spells;

    for (let i = 0; i < pool.length; i++) {
      const spell = pool[i];

      const weight =
        spell === undefined ? 0 : (options.weight?.(caster, spell) ?? ownWeight(registry.get(spell).activation));

      const fits =
        spell !== undefined &&
        weight > 0 &&
        options.allows?.(caster, spell) !== false &&
        this.#fits(caster, spell, options);

      weights[i] = fits ? weight : 0;
    }

    return weights;
  }

  /** Whether a spell would start now. */
  #fits(caster: G['bearer'], spell: SpellId, options: Pick<PickOptions<G>, 'input'>): boolean {
    return this.#spells.check(caster, spell, options.input === undefined ? undefined : options) === undefined;
  }
}

/** Where a last pick sits in a pool; −1 when it is not there. */
const indexOfPick = (pool: readonly SpellId[], last: number): number => {
  for (let i = 0; i < pool.length; i++) {
    if (pool[i] === last) {
      return i;
    }
  }

  return -1;
};

/** The spell whose share of the weights a point on `[0, total)` falls in; `undefined` for a total of 0. */
const draw = (pool: readonly SpellId[], weights: Float64Array, point: number): SpellId | undefined => {
  let at = point;
  let chosen: SpellId | undefined = undefined;

  for (let i = 0; i < pool.length; i++) {
    const weight = weights[i] ?? 0;

    if (weight > 0) {
      chosen = pool[i];

      if (at < weight) {
        return chosen;
      }

      at -= weight;
    }
  }

  return chosen;
};
