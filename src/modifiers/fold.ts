// Hot path (§I.4.2, §I.5.4): indexed loops, since an iterator over a frozen list was measured to allocate here.
/* oxlint-disable typescript/prefer-for-of */
import { evaluateCurve } from './evaluate.ts';
import { type Entry, FROM_HOST, FROM_STAT, type Sheet } from './sheet.ts';
import type { Derivation } from './stats.ts';

/**
 * The fold (§I.5), hand-written for its documented float order (§I.5.1): `clamp(min((base + Σ add + derived) × Π mul,
 * …caps))`, additions summed left to right in source order, multipliers applied one at a time in source order, caps in
 * turn, the clamp last. Every function here reads the sheet's current read (`sheet.view.read`), which the system sets
 * around each top-level read, and allocates nothing: the loops are indexed, since an iterator over a frozen list was
 * measured to allocate on this path (§I.5.4). A game's own gain measure is the one exception: it is handed a fresh
 * parts object on each call.
 */

/** The empty list, so that a missing list costs no allocation. */
const NONE: readonly never[] = Object.freeze([]);

/** Clamps a folded value to its stat's `min` / `max`: the ceiling first, then the floor. A NaN stays NaN. */
export const clampStat = <Host>(sheet: Sheet<Host>, stat: number, value: number): number => {
  const max = sheet.tables.max[stat] ?? Infinity;
  const min = sheet.tables.min[stat] ?? -Infinity;
  let clamped = value;

  if (clamped > max) {
    clamped = max;
  }

  if (clamped < min) {
    clamped = min;
  }

  return clamped;
};

/** The stacks of a gated entry: the read's what-if override, else the host's report, else none. */
const gateStacks = <Host>(sheet: Sheet<Host>, entry: Entry<Host>): number => {
  const read = sheet.view.read;
  const whatIf = read?.whatIf;

  if (whatIf?.gate === entry.gate) {
    return whatIf.stacks;
  }

  const host = read?.host;
  const { stacks } = sheet.tables;

  return host === undefined || stacks === undefined ? 0 : stacks(host, entry.gate);
};

/** Whether an entry's source is folded and its scope reached by the current read. */
const isReached = <Host>(sheet: Sheet<Host>, entry: Entry<Host>): boolean => {
  const read = sheet.view.read;
  const sources = read?.sources;

  if (sources !== undefined && ((sources >>> entry.source) & 1) === 0) {
    return false;
  }

  return entry.scope < 0 || read?.scope?.has(entry.scope) === true;
};

/**
 * How many stacks an entry counts with for the current read, or 0 when it does not count. Tested in this order, each
 * test only when the ones before it passed: the source is folded, the scope reached, the gate stacked, then the
 * condition met (a host value also needs a host). So a condition is asked only for an entry that would otherwise
 * count. An ungated entry counts with 1.
 */
export const liveStacks = <Host>(sheet: Sheet<Host>, entry: Entry<Host>): number => {
  if (!isReached(sheet, entry)) {
    return 0;
  }

  const stacks = entry.gate >= 0 ? gateStacks(sheet, entry) : 1;
  const host = sheet.view.read?.host;

  if (stacks <= 0) {
    return 0;
  }

  if (host === undefined) {
    return entry.test === undefined && entry.valueKind !== FROM_HOST ? stacks : 0;
  }

  return entry.test === undefined || entry.test(host, entry.testArg) ? stacks : 0;
};

/** The value an entry lands with at one stack: its number, its followed stat's bonus (capped), or its game read. */
export const entryValue = <Host>(sheet: Sheet<Host>, entry: Entry<Host>): number => {
  if (entry.valueKind === FROM_STAT) {
    const value = entry.per * (foldStat(sheet, entry.valueStat) - entry.neutral);

    return value > entry.cap ? entry.cap : value;
  }

  const host = sheet.view.read?.host;

  if (entry.valueKind === FROM_HOST && entry.read !== undefined && host !== undefined) {
    return entry.read(host, entry.readArg);
  }

  return entry.value;
};

/** An add at `stacks` stacks: the authored float at one stack or fewer, else `value × stacks`. */
export const stackedAdd = (value: number, stacks: number): number => (stacks <= 1 ? value : value * stacks);

/**
 * A mul at `stacks` stacks: the authored float at one stack or fewer, else `value ^ stacks`, or `1 + (value − 1) ×
 * stacks` for linear stacking (§II.6 M4).
 */
export const stackedMul = (entry: { readonly isLinear: boolean }, value: number, stacks: number): number => {
  if (stacks <= 1) {
    return value;
  }

  return entry.isLinear ? 1 + (value - 1) * stacks : value ** stacks;
};

/** Whether any entry of a list counts for the current read. */
const isAnyLive = <Host>(sheet: Sheet<Host>, entries: readonly Entry<Host>[] | undefined): boolean => {
  const list = entries ?? NONE;

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];

    if (entry !== undefined && liveStacks(sheet, entry) > 0) {
      return true;
    }
  }

  return false;
};

/** How far a stat's folded total sits above its base for the current read: `total − base`. */
const gain = <Host>(sheet: Sheet<Host>, stat: number): number => foldStat(sheet, stat) - (sheet.tables.base[stat] ?? 0);

/**
 * The gain a `derives` term applies its share to: `total − base` of the followed stat, or the game's own measure of it
 * over that stat's fold parts (`derives.gain`).
 */
export const derivedGain = <Host>(sheet: Sheet<Host>, derivation: Extract<Derivation, { kind: 'derives' }>): number => {
  const stat = derivation.from;

  if (derivation.gain === undefined) {
    return gain(sheet, stat);
  }

  const lists = sheet.compiled[stat];

  return derivation.gain({
    base: sheet.tables.base[stat] ?? 0,
    total: foldStat(sheet, stat),
    adds: lists === undefined ? 0 : foldAdds(sheet, lists.adds, 0),

    isAddOnly:
      (sheet.tables.derivations[stat]?.length ?? 0) === 0 &&
      !isAnyLive(sheet, lists?.muls) &&
      !isAnyLive(sheet, lists?.mins),

    min: sheet.tables.min[stat] ?? -Infinity,
    max: sheet.tables.max[stat] ?? Infinity,
  });
};

/**
 * A stat's derived terms added onto `value`, in order: `per × max(0, gain(from))` for `derives`, then each rating's
 * `curve(total(from))` (§II.6 M1, §II.3.14).
 */
const addDerived = <Host>(sheet: Sheet<Host>, stat: number, value: number): number => {
  const derivations = sheet.tables.derivations[stat] ?? NONE;
  let result = value;

  for (let i = 0; i < derivations.length; i++) {
    const derivation = derivations[i];

    if (derivation?.kind === 'derives') {
      result += derivation.per * Math.max(0, derivedGain(sheet, derivation));
    } else if (derivation !== undefined) {
      result += evaluateCurve(derivation.curve, foldStat(sheet, derivation.from), sheet.view);
    }
  }

  return result;
};

/** Every live addition of a list summed onto `value`, in order. */
const foldAdds = <Host>(sheet: Sheet<Host>, adds: readonly Entry<Host>[], value: number): number => {
  let result = value;

  for (let i = 0; i < adds.length; i++) {
    const entry = adds[i];
    const stacks = entry === undefined ? 0 : liveStacks(sheet, entry);

    if (entry !== undefined && stacks > 0) {
      result += stackedAdd(entryValue(sheet, entry), stacks);
    }
  }

  return result;
};

/** Every live multiplier applied to `value` one at a time, in source order (never pre-multiplied). */
const foldMuls = <Host>(sheet: Sheet<Host>, muls: readonly Entry<Host>[], value: number): number => {
  const skipsScoped = sheet.view.read?.scopedMuls === 'skip';
  let result = value;

  for (let i = 0; i < muls.length; i++) {
    const entry = muls[i];
    const stacks = entry === undefined || (skipsScoped && entry.scope >= 0) ? 0 : liveStacks(sheet, entry);

    if (entry !== undefined && stacks > 0) {
      result *= stackedMul(entry, entryValue(sheet, entry), stacks);
    }
  }

  return result;
};

/** Every live cap applied to `value` in turn, so the lowest live cap wins whatever its source. */
const foldMins = <Host>(sheet: Sheet<Host>, mins: readonly Entry<Host>[], value: number): number => {
  let result = value;

  for (let i = 0; i < mins.length; i++) {
    const entry = mins[i];
    const cap = entry !== undefined && liveStacks(sheet, entry) > 0 ? entryValue(sheet, entry) : result;

    if (cap < result) {
      result = cap;
    }
  }

  return result;
};

/**
 * Folds one stat for the sheet's current read: the base, the additions, the derived terms, the multipliers one by one
 * in source order, then each cap in turn, then the stat's clamp. The sheet must be built.
 */
export const foldStat = <Host>(sheet: Sheet<Host>, stat: number): number => {
  const lists = sheet.compiled[stat];
  let value = sheet.tables.base[stat] ?? 0;

  if (lists !== undefined) {
    value = foldAdds(sheet, lists.adds, value);
  }

  value = addDerived(sheet, stat, value);

  if (lists !== undefined) {
    value = foldMins(sheet, lists.mins, foldMuls(sheet, lists.muls, value));
  }

  return clampStat(sheet, stat, value);
};

/**
 * The product of the live scoped multipliers of a stat, in source order (1 when there are none): the part a read with
 * `scopedMuls: 'skip'` leaves out, for a caller that applies it at its own place in its own formula (§II.6 M5).
 */
export const scopedProduct = <Host>(sheet: Sheet<Host>, stat: number): number => {
  const muls = sheet.compiled[stat]?.muls ?? NONE;
  let value = 1;

  for (let i = 0; i < muls.length; i++) {
    const entry = muls[i];
    const stacks = entry !== undefined && entry.scope >= 0 ? liveStacks(sheet, entry) : 0;

    if (entry !== undefined && stacks > 0) {
      value *= stackedMul(entry, entryValue(sheet, entry), stacks);
    }
  }

  return value;
};
