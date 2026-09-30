import type { CompiledCurve, CompiledLookup, CompiledParam, CompiledScaled, CompiledTerm } from './compiled.ts';
import { checkCurve, checkPoints, type Curve, type CurveId, type CurveParam, type CurveRef } from './curves.ts';
import type { CurveTerm, PerRank, Scaled, Term } from './scaled.ts';
import type { StatId, StatIndex } from './stat-id.ts';
import type { StatTable } from './stats.ts';

/** How a scaled value or a curve is compiled, and what it is checked against. */
export interface CompileOptions {
  /** The owner's number of ranks: every per-rank list must have exactly this many entries. */
  readonly ranks?: number | undefined;

  /** Whether terms may read the target; false where there is none (a stat conversion). True when absent. */
  readonly allowsTarget?: boolean | undefined;

  /** What is being compiled, for error messages (`spell blast, damage`). */
  readonly what?: string | undefined;
}

/** The compile state shared by the parts of one value. */
interface Compiling {
  readonly index: StatIndex;
  readonly options: CompileOptions;
  readonly what: string;
}

/** The lengths of the per-rank lists of a value's own base and terms. */
const listLengths = (lists: readonly PerRank[]): number[] =>
  lists.flatMap((list) => (typeof list === 'number' ? [] : [list.length]));

/** The number of ranks a value's lists have, checked against the owner's ranks or against each other. */
const rankCountOf = (lists: readonly PerRank[], state: Compiling): number => {
  const lengths = listLengths(lists);
  const expected = state.options.ranks ?? lengths[0] ?? 1;
  const wrong = lengths.find((length) => length !== expected);

  if (wrong !== undefined) {
    const against = state.options.ranks === undefined ? 'the other lists' : `its ${expected} ranks`;

    throw new RangeError(`${state.what}: a per-rank list has ${wrong} entries, which does not match ${against}.`);
  }

  return lengths.length === 0 ? 1 : expected;
};

/** A per-rank list as a typed array of `rankCount` entries (a single number is repeated). */
const perRank = (list: PerRank, rankCount: number, what: string): Float64Array => {
  const values = Float64Array.from({ length: rankCount }, (_unused, rank) =>
    typeof list === 'number' ? list : (list[rank] ?? Number.NaN)
  );

  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`${what}: every base and ratio must be a finite number.`);
  }

  return values;
};

/** The id of a stat name, or a clear error naming the value. */
const statNamed = (name: string, state: Compiling): StatId => {
  const stat = state.index.idOf(name);

  if (stat === undefined) {
    throw new RangeError(`${state.what}: there is no stat named ${name}.`);
  }

  return stat;
};

/** The stat a curve term reads: its own, or the one stat whose definition declares the curve. */
const curveTermStat = (term: CurveTerm, curve: CurveRef, state: Compiling): string => {
  if (term.stat !== undefined) {
    return term.stat;
  }

  const declaring = typeof curve === 'string' ? state.index.declaring(curve) : [];
  const [only] = declaring;

  if (only === undefined || declaring.length > 1) {
    const found = declaring.length === 0 ? 'no stat declares' : 'several stats declare';

    throw new RangeError(`${state.what}: a curve term names no stat and ${found} its curve; name the stat.`);
  }

  return state.index.nameOf(only);
};

/** Checks a term's stat kind and options against its list at load time. */
const checkTerm = (term: Omit<CompiledTerm, 'coef' | 'neutral'>, state: Compiling): void => {
  const name = state.index.nameOf(term.stat);
  const isMultiplier = state.index.isMultiplier(term.stat);

  if (term.op === 'add' && isMultiplier) {
    throw new RangeError(`${state.what}: an add term needs a flat stat; ${name} is a multiplier stat (use amp).`);
  }

  if (term.op === 'amp' && !isMultiplier) {
    throw new RangeError(`${state.what}: an amp term needs a multiplier stat; ${name} is a flat stat (use add).`);
  }

  if (term.isBonus && term.op === 'amp') {
    throw new RangeError(`${state.what}: an amp term already reads ${name} from its neutral; drop of: 'bonus'.`);
  }

  if (term.isBonus && state.index.baseOf(term.stat) === 0) {
    throw new RangeError(`${state.what}: of: 'bonus' needs a base, and ${name} has base 0 (its bonus is its total).`);
  }

  if (term.isTarget && state.options.allowsTarget === false) {
    throw new RangeError(`${state.what}: a term reads the target's ${name}, but there is no target here.`);
  }
};

/** Compiles one term of a list. */
const compileTerm = (
  term: Term | CurveTerm,
  op: CompiledTerm['op'],
  place: {
    readonly rankCount: number;
    readonly curve?: CurveRef | undefined;
    readonly state: Compiling;
  }
): CompiledTerm => {
  const { state } = place;

  const name = op === 'curve' && place.curve !== undefined ? curveTermStat(term, place.curve, state) : term.stat;

  const stat = statNamed(name ?? '', state);
  const head = { op, stat, isBonus: term.of === 'bonus', isTarget: term.from === 'target' };

  checkTerm(head, state);

  return {
    ...head,
    coef: perRank(term.coef, place.rankCount, state.what),
    neutral: state.index.neutralOf(stat)
  };
};

/** The caster stats a compiled parameter reads, and whether it reads the target. */
const paramReads = (param: CompiledParam | undefined): { casters: readonly StatId[]; hasTarget: boolean } => {
  if (param === undefined || typeof param === 'number') {
    return { casters: [], hasTarget: false };
  }

  if (param.kind === 'lookup') {
    return { casters: param.isTarget ? [] : [param.stat], hasTarget: param.isTarget };
  }

  return { casters: param.casterStats, hasTarget: param.hasTarget };
};

/** The parameters of a compiled curve, for collecting what it reads. */
const curveParams = (curve: CompiledCurve | undefined): readonly (CompiledParam | undefined)[] => {
  switch (curve?.kind) {
    case 'linear':
    case 'rating': {
      return [curve.per];
    }

    case 'hyperbolic': {
      return [curve.k, curve.cap];
    }

    case 'stacking': {
      return [curve.rate];
    }

    case 'custom': {
      return curve.params;
    }

    case 'table':
    case undefined: {
      return [];
    }
  }
};

/** The caster stats a compiled curve's parameters read, each once: what a conversion through it follows. */
export const curveReads = (curve: CompiledCurve): readonly StatId[] => [
  ...new Set(curveParams(curve).flatMap((param) => paramReads(param).casters))
];

/** Compiles a scaled value with a stat index (the table's own conversions use this while the table is built). */
const compileScaledWith = (index: StatIndex, value: Scaled, options: CompileOptions = {}): CompiledScaled => {
  const state: Compiling = { index, options, what: options.what ?? 'A scaled value' };
  const scaling = typeof value === 'number' ? { base: value } : value;
  const adds = scaling.add ?? [];
  const amps = scaling.amp ?? [];
  const by = scaling.curve?.by ?? [];
  const lists = [scaling.base, ...[...adds, ...amps, ...by].map((term) => term.coef)];
  const rankCount = rankCountOf(lists, state);
  const curveRef = scaling.curve?.kind;

  const terms = [
    ...adds.map((term) => compileTerm(term, 'add', { rankCount, state })),
    ...amps.map((term) => compileTerm(term, 'amp', { rankCount, state })),
    ...by.map((term) => compileTerm(term, 'curve', { rankCount, curve: curveRef, state }))
  ];

  const curve = curveRef === undefined ? undefined : compileCurveWith(index, curveRef, options);
  const reads = curveParams(curve).map(paramReads);
  const own = terms.filter((term) => !term.isTarget).map((term) => term.stat);

  return Object.freeze({
    kind: 'scaled',
    rankCount,
    base: perRank(scaling.base, rankCount, state.what),
    terms: Object.freeze(terms),
    curve,
    hasTarget: terms.some((term) => term.isTarget) || reads.some((read) => read.hasTarget),
    casterStats: Object.freeze([...new Set([...own, ...reads.flatMap((read) => read.casters)])])
  });
};

/** Compiles a table lookup parameter. */
const compileLookup = (lookup: Extract<CurveParam, { kind: 'lookup' }>, state: Compiling): CompiledLookup => {
  checkPoints(lookup.points, `${state.what}: a lookup on ${lookup.stat}`);

  const isTarget = lookup.from === 'target';

  if (isTarget && state.options.allowsTarget === false) {
    throw new RangeError(`${state.what}: a lookup reads the target's ${lookup.stat}, but there is no target here.`);
  }

  return {
    kind: 'lookup',
    stat: statNamed(lookup.stat, state),
    isTarget,
    xs: Float64Array.from(lookup.points, ([x]) => x),
    ys: Float64Array.from(lookup.points, ([, y]) => y)
  };
};

/** Compiles a curve parameter. */
const compileParam = (param: CurveParam, state: Compiling): CompiledParam => {
  if (typeof param === 'number') {
    return param;
  }

  return 'kind' in param ? compileLookup(param, state) : compileScaledWith(state.index, param, state.options);
};

/** Compiles a curve object's parameters. */
const compileCurveObject = (curve: Curve, id: CurveId | undefined, state: Compiling): CompiledCurve => {
  const param = (value: CurveParam): CompiledParam => compileParam(value, state);

  switch (curve.kind) {
    case 'linear':
    case 'rating': {
      return { kind: curve.kind, id, per: param(curve.per) };
    }

    case 'hyperbolic': {
      const cap = curve.cap === undefined ? undefined : param(curve.cap);

      return {
        kind: 'hyperbolic',
        id,
        k: param(curve.k),
        cap,
        isAmplifying: curve.negative === 'amplify'
      };
    }

    case 'stacking': {
      return { kind: 'stacking', id, rate: param(curve.rate) };
    }

    case 'table': {
      const xs = Float64Array.from(curve.points, ([x]) => x);

      return { kind: 'table', id, xs, ys: Float64Array.from(curve.points, ([, y]) => y) };
    }

    case 'custom': {
      const names = Object.keys(curve.params);
      const params = names.map((name) => param(curve.params[name] ?? 0));
      const values = Object.fromEntries(names.map((name) => [name, 0]));

      return { kind: 'custom', id, names, params, values, map: curve.map };
    }
  }
};

/** Compiles a curve (by name in the game's table, or inline) with a stat index, checking its parameters. */
export const compileCurveWith = (index: StatIndex, ref: CurveRef, options: CompileOptions = {}): CompiledCurve => {
  const state: Compiling = { index, options, what: options.what ?? 'A curve' };

  if (typeof ref !== 'string') {
    checkCurve(ref);

    return compileCurveObject(ref, undefined, state);
  }

  const named = index.curveNamed(ref);

  if (named === undefined) {
    throw new RangeError(`${state.what}: there is no curve named ${ref} in the game's curve table.`);
  }

  return compileCurveObject(named.curve, named.id, state);
};

/**
 * Compiles a scaled value against the game's stat table, as a registry does when it is built: names become
 * ids, lists become typed arrays, and every load-time check runs (an `add` term needs a flat stat and an `amp` term a
 * multiplier stat, `of: 'bonus'` needs a base, per-rank lists match the ranks, curve parameters are in range).
 */
export const compileScaled = <S extends string>(
  stats: StatTable<S>,
  value: Scaled<S>,
  options: CompileOptions = {}
): CompiledScaled => compileScaledWith(stats.index, value, options);

/** Compiles a curve (a name in the game's curve table, or a curve object) against the game's stat table. */
export const compileCurve = <S extends string>(
  stats: StatTable<S>,
  ref: CurveRef<S>,
  options: CompileOptions = {}
): CompiledCurve => compileCurveWith(stats.index, ref, options);
