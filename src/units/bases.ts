import { type Modifier, type ModifierList, plus } from '../modifiers/index.ts';
import type { SpawnUnit, UnitSystemOptions } from './engine.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * A template with base stats of its own, compiled once (`units.variant(template, stats)`): every unit spawned with it
 * shares its bases and their compiled modifiers, where a spawn's own `stats` compile for that unit alone.
 */
export interface UnitVariant {
  /** Its template. */
  readonly template: UnitId;
}

/** A variant's record: its bases and their compiled modifiers (none without a modifier system). */
class VariantRecord implements UnitVariant {
  readonly template: UnitId;
  readonly base: ArrayLike<number>;
  readonly list: ModifierList | undefined;

  constructor(template: UnitId, [base, list]: readonly [ArrayLike<number>, ModifierList | undefined]) {
    this.template = template;
    this.base = base;
    this.list = list;
  }
}

/**
 * The units' base stats: a template's, a variant's (compiled once), or a spawn's own (compiled for it), with their
 * compiled modifiers at the base source.
 */
export class UnitBases<G extends UnitTypes> {
  readonly #options: UnitSystemOptions<G>;

  /** Each template's compiled base list, shared by every unit spawned with its template's stats alone. */
  readonly #templateLists: (ModifierList | undefined)[] = [];

  constructor(options: UnitSystemOptions<G>) {
    this.#options = options;
  }

  /** Compiles bases into the adds that move the stat table's bases to them; none without a modifier system. */
  compile(base: ArrayLike<number>): ModifierList | undefined {
    return this.#options.modifiers?.system.compile(this.#modifiersOf(base));
  }

  /** A variant of a template with base stats of its own, compiled once. */
  variant(template: UnitId, stats: Readonly<Partial<Record<G['stat'], number>>>): UnitVariant {
    const base = this.baseFor(template, stats);

    return Object.freeze(new VariantRecord(template, [base, this.compile(base)]));
  }

  /** A spawn's bases: its variant's, its own over its template's, or its template's. */
  baseOf(template: UnitId, spawn: SpawnUnit<G>): ArrayLike<number> {
    return this.#variantFor(template, spawn)?.base ?? this.baseFor(template, spawn.stats);
  }

  /** The compiled list a spawn shares: its variant's or its template's; `undefined` when it has stats of its own. */
  sharedListOf(template: UnitId, spawn: SpawnUnit<G>): ModifierList | undefined {
    const variant = this.#variantFor(template, spawn);

    if (variant !== undefined) {
      return variant.list;
    }

    return spawn.stats === undefined ? this.templateList(template) : undefined;
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
   * read-only, so a horde of one template holds one array).
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

      base[id] = value ?? base[id] ?? 0;
    }

    return base;
  }

  /** A template's compiled base list, made once and shared by every unit spawned with its stats alone. */
  templateList(template: UnitId): ModifierList | undefined {
    const { registry } = this.#options;

    return (this.#templateLists[template] ??= this.compile(registry.bases[template] ?? registry.stats.columns.base));
  }

  /** The adds that move the stat table's bases to a unit's own. */
  #modifiersOf(base: ArrayLike<number>): Modifier<G['stat'], G['condition'], G['valueKind']>[] {
    const tableBase = this.#options.registry.stats.columns.base;

    const names: readonly G['stat'][] = this.#options.registry.stats.names.filter(
      (name): name is G['stat'] => name.length >= 0,
    );

    return Array.from(base).flatMap((value, stat) => {
      const delta = value - (tableBase[stat] ?? 0);
      const name = names[stat];

      return delta === 0 || name === undefined ? [] : [plus(name, delta)];
    });
  }
}

/** Throws a `RangeError` for a unit system problem. */
const missing = (problem: string): never => {
  throw new RangeError(`Unit system: ${problem}.`);
};
