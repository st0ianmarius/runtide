import type { SpawnUnit, UnitSystemOptions } from './engine.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * A template with base stats of its own, made once (`units.variant(template, stats)`): every unit spawned with it
 * shares its bases, where a spawn's own `stats` make an array for that unit alone.
 */
export interface UnitVariant {
  /** Its template. */
  readonly template: UnitId;
}

/** A variant's record: its bases, and its index among its system's variants, in the order they were made. */
class VariantRecord implements UnitVariant {
  readonly template: UnitId;
  readonly base: ArrayLike<number>;
  readonly index: number;

  constructor(template: UnitId, base: ArrayLike<number>, index: number) {
    this.template = template;
    this.base = base;
    this.index = index;
  }
}

/**
 * The index of a spawn's variant among its system's variants, from 0 in the order `units.variant` made them; −1 for a
 * spawn with none. Read once `baseOf` has checked the spawn.
 */
export const variantIndexOf = <G extends UnitTypes>(spawn: SpawnUnit<G>): number =>
  spawn.variant instanceof VariantRecord ? spawn.variant.index : -1;

/**
 * The units' base stats: a template's, a variant's (made once), or a spawn's own (made for it), which its stat sheet
 * starts every fold from (`modifiers.setBases`).
 */
export class UnitBases<G extends UnitTypes> {
  readonly #options: UnitSystemOptions<G>;

  /** How many variants were made: the next one's index. */
  #variants = 0;

  constructor(options: UnitSystemOptions<G>) {
    this.#options = options;
  }

  /** A variant of a template with base stats of its own, made once. */
  variant(template: UnitId, stats: Readonly<Partial<Record<G['stat'], number>>>): UnitVariant {
    const base = this.baseFor(template, stats);

    const made = new VariantRecord(template, base, this.#variants);

    this.#variants += 1;

    return Object.freeze(made);
  }

  /** A spawn's bases: its variant's, its own over its template's, or its template's. */
  baseOf(template: UnitId, spawn: SpawnUnit<G>): ArrayLike<number> {
    return this.#variantFor(template, spawn)?.base ?? this.baseFor(template, spawn.stats);
  }

  /** A spawn's variant, checked against its template and its own stats; `undefined` for none. */
  #variantFor(template: UnitId, spawn: SpawnUnit<G>): VariantRecord | undefined {
    const { variant } = spawn;

    if (variant === undefined) {
      return undefined;
    }

    if (!(variant instanceof VariantRecord) || variant.template !== template || spawn.stats !== undefined) {
      return missing("a spawn's variant is one units.variant made for its template, in place of its own stats");
    }

    return variant;
  }

  /**
   * Base stats: a template's, with `own` on top in a copy; none of its own shares its template's (a unit's bases are
   * read-only, so a horde of one template holds one array). Throws for a stat not in the table or not finite.
   */
  baseFor(template: UnitId, own: SpawnUnit<G>['stats']): ArrayLike<number> {
    const { stats } = this.#options.registry;
    const shared = this.#options.registry.bases[template] ?? stats.columns.base;

    if (own === undefined) {
      return shared;
    }

    const base = Float64Array.from(shared);

    for (const [stat, value] of Object.entries<number | undefined>(own)) {
      const id = stats.index.idOf(stat) ?? missing(`there is no stat named ${stat}`);

      if (value !== undefined && !Number.isFinite(value)) {
        missing(`unit ${this.#options.registry.name(template)}'s ${stat} must be a finite number; got ${value}`);
      }

      base[id] = value ?? base[id] ?? 0;
    }

    return base;
  }
}

/** Throws a `RangeError` for a unit system problem. */
const missing = (problem: string): never => {
  throw new RangeError(`Unit system: ${problem}.`);
};
