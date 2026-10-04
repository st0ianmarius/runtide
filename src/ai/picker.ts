import type { Random } from '../core/index.ts';
import type { CastOptions, SpellId, SpellSystem } from '../spells/index.ts';
import type { AiTypes } from './ai-types.ts';

/**
 * How a pick is made: every part but the draw is optional, and a game makes one set per kind
 * of brain, once, so a pick allocates nothing.
 */
export interface PickOptions<G extends AiTypes> {
  /** The draw the weighted pick takes (a creature's keyed stream, a horde's shared one). */
  readonly random: Random;

  /** What each candidate is checked with (`spells.check`): its target, an aim. None when absent. */
  readonly input?: G['input'];

  /**
   * What one candidate is checked with, in place of `input`: a heal aimed at the weakest ally beside a strike at the
   * focus, weighed in one pick. The game casts the picked spell with the same input.
   */
  readonly inputOf?: (caster: G['bearer'], spell: SpellId) => G['input'] | undefined;

  /**
   * A spell's weight for this caster now (distance, hugged, clumped: the game's reading, or its own per-spell
   * weights); 1 when absent. A weight of 0 or less leaves the spell out; one that is not a finite number (NaN, an
   * infinity) throws a `RangeError`.
   */
  readonly weight?: (caster: G['bearer'], spell: SpellId) => number;

  /** Whether a spell may be picked now: a budget, a gap the game keeps. Every spell may when absent. */
  readonly allows?: (caster: G['bearer'], spell: SpellId) => boolean;
}

/**
 * The one weighted picker: over a pool of spells, each fitting one (a weight above 0, allowed, and one that would
 * start: `spells.check`, so range, sight and the gates are the spell's own) is drawn with a chance in proportion to
 * its weight. Deterministic for a given draw. Leaving out the last pick is the game's, through its `weight`.
 */
export class Picker<G extends AiTypes> {
  readonly #spells: SpellSystem<G>;
  readonly #check = new CheckOptions<G>();
  readonly #weights: Float64Array[] = [new Float64Array(8)];
  #depth = 0;

  constructor(spells: SpellSystem<G>) {
    this.#spells = spells;
  }

  /**
   * Picks a spell from `pool` for `caster`, or `undefined`, drawing nothing, when none fits. Throws a `RangeError` for a
   * weight that is not finite, or weights whose total is not.
   */
  pick(caster: G['bearer'], pool: readonly SpellId[], options: PickOptions<G>): SpellId | undefined {
    const depth = this.#depth;
    let weights = this.#weights[depth];

    if (weights === undefined || weights.length < pool.length) {
      weights = new Float64Array(Math.max(8, pool.length * 2));
      this.#weights[depth] = weights;
    }

    this.#depth += 1;

    try {
      this.#weigh(caster, pool, options, weights);
      let total = 0;

      for (let i = 0; i < pool.length; i++) {
        total += weights[i] ?? 0;
      }

      if (!Number.isFinite(total)) {
        throw new RangeError(
          `The picker's weights add up to ${total}; keep them finite and far below the largest number.`
        );
      }

      // Nothing fits: no draw is taken, so an empty pick shifts no later draw of the stream (a crit, a placement).
      return total > 0 ? draw(pool, weights, total * options.random()) : undefined;
    } finally {
      this.#depth = depth;
    }
  }

  /**
   * The first spell of an ordered list that would start now (a reaction's forced cast before the picker),
   * allowed when `allows` says so; `undefined` when none would.
   */
  first(
    caster: G['bearer'],
    spells: readonly SpellId[],
    options: Pick<PickOptions<G>, 'input' | 'inputOf' | 'allows'> = {}
  ): SpellId | undefined {
    for (const spell of spells) {
      if (options.allows?.(caster, spell) !== false && this.#fits(caster, spell, options)) {
        return spell;
      }
    }

    return undefined;
  }

  /** Each candidate's weight, 0 for one that does not fit, into the reused column. */
  #weigh(caster: G['bearer'], pool: readonly SpellId[], options: PickOptions<G>, weights: Float64Array): void {
    for (let i = 0; i < pool.length; i++) {
      const spell = pool[i];

      const weight = spell === undefined ? 0 : (options.weight?.(caster, spell) ?? 1);

      if (!Number.isFinite(weight)) {
        throw new RangeError(`A pick weight is a finite number; got ${weight} for spell ${spell}.`);
      }

      const fits =
        spell !== undefined &&
        weight > 0 &&
        options.allows?.(caster, spell) !== false &&
        this.#fits(caster, spell, options);

      weights[i] = fits ? weight : 0;
    }
  }

  /** Whether a spell would start now, checked with its input. */
  #fits(caster: G['bearer'], spell: SpellId, options: Pick<PickOptions<G>, 'input' | 'inputOf'>): boolean {
    const check = this.#check;

    check.input = options.inputOf === undefined ? options.input : options.inputOf(caster, spell);

    try {
      return this.#spells.check(caster, spell, check) === undefined;
    } finally {
      check.input = undefined;
    }
  }
}

/** The options a candidate is checked with, reused: its input alone. */
class CheckOptions<G extends AiTypes> implements CastOptions<G> {
  input: G['input'] | undefined = undefined;
}

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
