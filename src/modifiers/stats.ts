import { createRegistry, type Registry } from '../core/index.ts';
import { compileCurveWith } from './compile-values.ts';
import type { CompiledCurve } from './compiled.ts';
import { type CurveRef, type CurveTable, DEFAULT_CURVES } from './curves.ts';
import type { StatId, StatIndex } from './stat-id.ts';

/**
 * One stat of the game's table (§II.3.13, §II.6 M1). A flat stat is a quantity (attack damage, armor); a multiplier
 * stat is a percentage around a neutral value (a damage bonus at 1). A stat resolves as
 * `clamp(min((base + Σ add + derived) × Π mul, …caps))`.
 */
export interface StatDef<S extends string = string> {
  /** The value before any source; it may be infinite (an unbounded cap), never NaN. */
  readonly base: number;

  /** Whether the stat is a quantity or a percentage around its neutral value. */
  readonly kind: 'flat' | 'multiplier';

  /** What an `amp` term or a stat-valued modifier measures a bonus from: 0 for a flat stat, 1 for a multiplier stat. */
  readonly neutral?: number;

  /** The floor of the final clamp, which runs last, after the caps. */
  readonly min?: number;

  /** The ceiling of the final clamp, which runs last, after the caps. */
  readonly max?: number;

  /** The name of the curve that turns this stat into its effect (`'haste'`); curve terms with no stat read this stat. */
  readonly curve?: string;

  /**
   * Grows with another stat: `per × max(0, gain(from))` is added after this stat's additions and before its
   * multipliers, where the gain is how far `from`'s total sits above its base (`total − base`), or what `gain`
   * measures when the game gives it.
   */
  readonly derives?: {
    /** The stat whose gain it follows. */
    readonly from: S;

    /** The share of that gain added. */
    readonly per: number;

    /**
     * The game's own measure of the followed stat's gain (§I.5.6 hatch 2), in place of `total − base`: it is handed
     * the parts of that stat's fold for the current read and returns the gain the share applies to.
     */
    readonly gain?: GainMeasure;
  };

  /**
   * A rating's conversion (§II.3.14): `curve(total)` of this stat is added to the `to` stat after its additions and
   * before its multipliers. Curve parameters read the bearer as the caster; there is no target.
   */
  readonly converts?: {
    /** The stat this one converts into. */
    readonly to: S;

    /** The curve the rating goes through; stat names inside it are checked when the table is built. */
    readonly curve: CurveRef;
  };
}

/** The parts of a followed stat's fold that a game's own gain measure reads, for the current read. */
export interface GainParts {
  /** The followed stat's base. */
  readonly base: number;

  /** Its folded total: what `resolve` returns for the same read. */
  readonly total: number;

  /** The sum of its live additions at their stacks, in fold order, starting from 0. */
  readonly adds: number;

  /** Whether only additions count for this read: no live multiplier, no live cap, no derived term of its own. */
  readonly isAddOnly: boolean;

  /** The floor of its clamp. */
  readonly min: number;

  /** The ceiling of its clamp. */
  readonly max: number;
}

/**
 * A game's own measure of how far a followed stat has grown (`derives.gain`). It must be deterministic and must not
 * keep the parts, which are built for this call. It runs on every read of the deriving stat.
 */
export type GainMeasure = (parts: GainParts) => number;

/** One derived term of a stat: a `derives` share or a rating conversion into it, in the order they apply. */
export type Derivation =
  | {
      /** The discriminant. */
      readonly kind: 'derives';

      /** The stat whose gain is followed. */
      readonly from: StatId;

      /** The share of the gain added. */
      readonly per: number;

      /** The game's own gain measure, when it gave one. */
      readonly gain: GainMeasure | undefined;
    }
  | {
      /** The discriminant. */
      readonly kind: 'converts';

      /** The rating stat converted. */
      readonly from: StatId;

      /** The compiled curve it goes through. */
      readonly curve: CompiledCurve;
    };

/** The columns every stat table has, indexed by stat id. */
type StatColumn = 'base' | 'neutral' | 'min' | 'max' | 'isMultiplier';

/**
 * The game's stat table: a registry of stats with dense ids (§I.5.4), typed columns for the fold (`base`, `neutral`,
 * `min` and `max` as `Float64Array`, `isMultiplier` as `Uint8Array`), the derived terms of every stat, and the curve
 * table its stats and scaled values name curves in.
 */
export interface StatTable<Name extends string = string> extends Registry<
  'stats',
  Name,
  StatDef<Name>,
  StatColumn,
  never
> {
  /** What compiling scaled values and curves reads (`compileScaled`, `compileCurve`). */
  readonly index: StatIndex;

  /** The game's named curves. */
  readonly curves: CurveTable;

  /** The derived terms of every stat, by stat id: its own `derives` first, then every conversion into it in id order. */
  readonly derivations: readonly (readonly Derivation[])[];
}

/** Throws unless a definition's numbers and kind are sound. */
const checkDef = (name: string, def: StatDef): void => {
  const isSound = (value: number | undefined): boolean => value === undefined || !Number.isNaN(value);

  if (def.kind !== 'flat' && def.kind !== 'multiplier') {
    throw new RangeError(`Stat ${name}: kind must be 'flat' or 'multiplier'.`);
  }

  if (!isSound(def.base) || !isSound(def.min) || !isSound(def.max) || !Number.isFinite(def.neutral ?? 0)) {
    throw new RangeError(`Stat ${name}: base, min and max must be numbers and neutral finite.`);
  }

  if ((def.min ?? -Infinity) > (def.max ?? Infinity)) {
    throw new RangeError(`Stat ${name}: min ${def.min} is above max ${def.max}.`);
  }
};

/** Builds the stat index over a registry of stats and a curve table. */
const indexOf = (stats: Registry<'stats', string, StatDef, StatColumn, never>, curves: CurveTable): StatIndex => {
  const ids = new Map(stats.ids.map((id) => [stats.name(id), id]));
  const curveIds = new Map(curves.ids.map((id) => [curves.name(id), id]));

  return {
    idOf: (name) => ids.get(name),
    nameOf: (stat) => stats.name(stat),
    isMultiplier: (stat) => stats.get(stat).kind === 'multiplier',
    baseOf: (stat) => stats.get(stat).base,
    neutralOf: (stat) => stats.columns.neutral[stat] ?? 0,
    declaring: (curve) => stats.ids.filter((id) => stats.get(id).curve === curve),

    curveNamed: (name) => {
      const id = curveIds.get(name);

      return id === undefined ? undefined : { id, curve: curves.get(id) };
    },
  };
};

/** The id of a stat named by another stat's definition, or a clear error. */
const linked = (index: StatIndex, owner: string, name: string): StatId => {
  const id = index.idOf(name);

  if (id === undefined || name === owner) {
    throw new RangeError(`Stat ${owner}: ${id === undefined ? `there is no stat named ${name}` : 'it names itself'}.`);
  }

  return id;
};

/** The derived terms of every stat, compiled: each stat's `derives`, then each conversion into it in id order. */
const buildDerivations = (
  stats: Registry<'stats', string, StatDef, StatColumn, never>,
  index: StatIndex,
): Derivation[][] => {
  const out: Derivation[][] = stats.names.map(() => []);

  for (const id of stats.ids) {
    const { derives } = stats.get(id);

    if (derives !== undefined) {
      if (!Number.isFinite(derives.per)) {
        throw new RangeError(`Stat ${stats.name(id)}: derives.per must be finite.`);
      }

      out[id]?.push({
        kind: 'derives',
        from: linked(index, stats.name(id), derives.from),
        per: derives.per,
        gain: derives.gain,
      });
    }
  }

  for (const id of stats.ids) {
    const { converts } = stats.get(id);

    if (converts !== undefined) {
      const what = `Stat ${stats.name(id)}, conversion`;
      const curve = compileCurveWith(index, converts.curve, { allowsTarget: false, what });

      out[linked(index, stats.name(id), converts.to)]?.push({ kind: 'converts', from: id, curve });
    }
  }

  return out;
};

/** Throws when derived terms form a cycle (a stat that, through derives and conversions, follows itself). */
const checkAcyclic = (derivations: readonly (readonly Derivation[])[], nameOf: (stat: number) => string): void => {
  const state = new Uint8Array(derivations.length);

  const visit = (stat: number): void => {
    if (state[stat] === 2) {
      return;
    }

    if (state[stat] === 1) {
      throw new RangeError(`Stat ${nameOf(stat)} derives from itself through derives or converts.`);
    }

    state[stat] = 1;

    for (const derivation of derivations[stat] ?? []) {
      visit(derivation.from);
    }

    state[stat] = 2;
  };

  for (const stat of derivations.keys()) {
    visit(stat);
  }
};

/**
 * Declares the game's stat table (§II.3.13): each stat's base, kind, neutral value, clamp, curve, derived share and
 * rating conversion, checked at load. `curves` is the game's curve table (`defineCurves`), `haste` alone by default.
 */
export const defineStats = <const Defs extends Readonly<Record<string, StatDef<Extract<keyof Defs, string>>>>>(
  defs: Defs,
  options: {
    /** The game's curve table, which stats and scaled values name curves in. */
    readonly curves?: CurveTable;
  } = {},
): StatTable<Extract<keyof Defs, string>> => {
  type Name = Extract<keyof Defs, string>;

  for (const [name, def] of Object.entries<StatDef>(defs)) {
    checkDef(name, def);
  }

  const curves = options.curves ?? DEFAULT_CURVES;

  const registry = createRegistry<Readonly<Record<Name, StatDef<Name>>>, 'stats', StatColumn>(defs, {
    kind: 'stats',

    columns: {
      base: { type: 'f64', of: (def) => def.base },
      neutral: { type: 'f64', of: (def) => def.neutral ?? (def.kind === 'multiplier' ? 1 : 0) },
      min: { type: 'f64', of: (def) => def.min ?? -Infinity },
      max: { type: 'f64', of: (def) => def.max ?? Infinity },
      isMultiplier: { type: 'u8', of: (def) => (def.kind === 'multiplier' ? 1 : 0) },
    },
  });

  const index = indexOf(registry, curves);

  for (const id of registry.ids) {
    const { curve } = registry.get(id);

    if (curve !== undefined && index.curveNamed(curve) === undefined) {
      throw new RangeError(`Stat ${registry.name(id)}: there is no curve named ${curve} in the game's curve table.`);
    }
  }

  const derivations = buildDerivations(registry, index);

  checkAcyclic(derivations, (stat) => registry.names[stat] ?? String(stat));

  return Object.freeze({
    ...registry,
    index,
    curves,
    derivations: Object.freeze(derivations.map((list) => Object.freeze(list))),
  });
};
