// Hot path: indexed loops, since an iterator over a frozen list was measured to allocate here.
/* oxlint-disable typescript/prefer-for-of */
import { evaluateCurve } from './evaluate.ts';
import { liveStacks } from './live.ts';
import type { SharedAt } from './shared.ts';
import { type CompiledStat, type Entry, FROM_HOST, FROM_STAT, type Sheet } from './sheet.ts';
import { clampStat, stackedAdd, stackedMul } from './stacked.ts';
import type { Derivation } from './stats.ts';

/**
 * The fold, hand-written for its documented float order: `clamp(min((base + Σ add + derived) × Π mul,
 * …caps))`, additions summed left to right in source order, multipliers applied one at a time in source order, caps in
 * turn, the clamp last. Every function here reads the sheet's current read (`sheet.view.read`), which the system sets
 * around each top-level read, and allocates nothing: the loops are indexed, since an iterator over a frozen list was
 * measured to allocate on this path. A game's own gain measure is the one exception: it is handed a fresh
 * parts object on each call. The shared (aura) lists are walked by the gates the host holds, so a read costs what the
 * bearer holds and never grows with the number of gated lists the game defines.
 */

/** The empty list, so that a missing list costs no allocation. */
const NONE: readonly never[] = Object.freeze([]);

/** A walk over a stat's additions. */
const ADD = 0;

/** A walk over a stat's multipliers. */
const MUL = 1;

/** A walk over a stat's caps. */
const MIN = 2;

/** A walk that takes only the scoped entries (a scoped product). */
const SCOPED_ONLY = 4;

/** A walk that only asks whether any entry counts: its value turns 1 on the first that does. */
const ANY_LIVE = 8;

/** The list of a stat's entries a walk reads, by its low bits (a named read, not a keyed one: this is hot). */
const listOf = <Host>(lists: CompiledStat<Host> | undefined, how: number): readonly Entry<Host>[] => {
  const op = how & 3;

  if (lists === undefined) {
    return NONE;
  }

  if (op === ADD) {
    return lists.adds;
  }

  return op === MUL ? lists.muls : lists.mins;
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

/** Whether the current walk takes an entry: a scoped product only scoped ones, a fold skipping scoped muls none. */
const isTaken = <Host>(sheet: Sheet<Host>, entry: Entry<Host>, how: number): boolean => {
  if ((how & SCOPED_ONLY) !== 0) {
    return entry.scope >= 0;
  }

  return entry.scope < 0 || (how & (3 | ANY_LIVE)) !== MUL || sheet.view.read?.scopedMuls !== 'skip';
};

/** What a counted entry lands with at `stacks` stacks: a stacked add, a stacked multiplier, or a cap. */
const landedAt = <Host>(sheet: Sheet<Host>, entry: Entry<Host>, stacks: number): number => {
  const value = entryValue(sheet, entry);
  const { op } = entry.modifier;

  if (op === 'add') {
    return stackedAdd(value, stacks);
  }

  return op === 'mul' ? stackedMul(entry, value, stacks) : value;
};

/** One entry folded into the current walk's running value, when the walk takes it and it counts. */
const step = <Host>(sheet: Sheet<Host>, entry: Entry<Host>, value: number): number => {
  const how = sheet.how;
  const stacks = isTaken(sheet, entry, how) ? liveStacks(sheet, entry) : 0;

  if (stacks <= 0) {
    return value;
  }

  if ((how & ANY_LIVE) !== 0) {
    return 1;
  }

  const landed = landedAt(sheet, entry, stacks);
  const op = how & 3;

  if (op === ADD) {
    return value + landed;
  }

  if (op === MUL) {
    return value * landed;
  }

  return landed < value ? landed : value;
};

/** The shared entries of one gate for the current walk's list, or none. */
const gateList = <Host>(sheet: Sheet<Host>, at: SharedAt<Host>, gate: number): readonly Entry<Host>[] => {
  const index = gate < 0 ? -1 : (at.slots[gate] ?? -1);

  return index < 0 ? NONE : listOf(at.entries[index], sheet.how);
};

/** The gates the current read's host holds (`held`), in ascending order, or none without a host. */
const heldGates = <Host>(sheet: Sheet<Host>): readonly { readonly id: number }[] => {
  const host = sheet.view.read?.host;

  return host === undefined ? NONE : (sheet.tables.held?.(host) ?? NONE);
};

/**
 * The shared entries at a marker folded for the gates the host holds (`held`), in gate order, with the read's what-if
 * gate (`pending`) walked in its place: the cost follows what the host holds, never what the game defines.
 */
const walkHeld = <Host>(sheet: Sheet<Host>, at: SharedAt<Host>, value: number): number => {
  const gates = heldGates(sheet);
  let pending = sheet.view.read?.whatIf?.gate ?? -1;
  let previous = -1;
  let result = value;

  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i]?.id ?? previous;

    if (gate !== previous && pending >= 0 && pending <= gate) {
      result = walkList(sheet, gateList(sheet, at, pending === gate ? -1 : pending), result);
      pending = -1;
    }

    result = gate === previous ? result : walkList(sheet, gateList(sheet, at, gate), result);
    previous = gate;
  }

  return walkList(sheet, gateList(sheet, at, pending), result);
};

/**
 * The shared entries at a marker folded into the current walk's running value, in gate order: only the host's held
 * gates when the system has a `held` report or the read no host (which counts only its what-if gate), else every gate.
 */
const walkShared = <Host>(sheet: Sheet<Host>, at: SharedAt<Host>, value: number): number => {
  if (sheet.tables.held !== undefined || sheet.view.read?.host === undefined) {
    return walkHeld(sheet, at, value);
  }

  let result = value;

  for (let i = 0; i < at.gates.length; i++) {
    result = walkList(sheet, gateList(sheet, at, at.gates[i] ?? -1), result);
  }

  return result;
};

/**
 * Every entry of a list folded into the current walk's running value, in order, a marker walking its shared entries
 * in its place. A caller sets `sheet.how` and restores it after, as it does `read`, so a nested fold (a stat-valued
 * entry, a condition reading a stat) walks its own.
 */
const walkList = <Host>(sheet: Sheet<Host>, list: readonly Entry<Host>[], value: number): number => {
  let result = value;

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];

    if (entry?.shared !== undefined) {
      result = walkShared(sheet, entry.shared, result);
    } else if (entry !== undefined) {
      result = step(sheet, entry, result);
    }
  }

  return result;
};

/** Walks one list of a stat as `sheet.how` says, from `value`. */
const walk = <Host>(sheet: Sheet<Host>, stat: number, value: number): number =>
  walkList(sheet, listOf(sheet.compiled[stat], sheet.how), value);

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

  const how = sheet.how;

  sheet.how = ADD;

  const adds = walk(sheet, stat, 0);

  sheet.how = MUL | ANY_LIVE;

  const anyMul = walk(sheet, stat, 0);

  sheet.how = MIN | ANY_LIVE;

  const anyMin = walk(sheet, stat, 0);

  sheet.how = how;

  return derivation.gain({
    base: sheet.tables.base[stat] ?? 0,
    total: foldStat(sheet, stat),
    adds,
    isAddOnly: (sheet.tables.derivations[stat]?.length ?? 0) === 0 && anyMul === 0 && anyMin === 0,

    min: sheet.tables.min[stat] ?? -Infinity,
    max: sheet.tables.max[stat] ?? Infinity,
  });
};

/**
 * A stat's derived terms added onto `value`, in order: `per × max(0, gain(from))` for `derives`, then each rating's
 * `curve(total(from))`.
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

// The fold's own loops, one per list, as plain as the float order allows: each walks a marker's shared
// entries (`walkShared`, for which the caller set `sheet.how`) and counts every other entry itself.

/** Every live addition of a list summed onto `value`, in order. */
const foldAdds = <Host>(sheet: Sheet<Host>, adds: readonly Entry<Host>[], value: number): number => {
  let result = value;

  for (let i = 0; i < adds.length; i++) {
    const entry = adds[i];
    const stacks = entry === undefined || entry.shared !== undefined ? 0 : liveStacks(sheet, entry);

    if (entry?.shared !== undefined) {
      result = walkShared(sheet, entry.shared, result);
    } else if (entry !== undefined && stacks > 0) {
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
    const isSkipped = entry === undefined || entry.shared !== undefined || (skipsScoped && entry.scope >= 0);
    const stacks = isSkipped ? 0 : liveStacks(sheet, entry);

    if (entry?.shared !== undefined) {
      result = walkShared(sheet, entry.shared, result);
    } else if (entry !== undefined && stacks > 0) {
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
    const isLive = entry !== undefined && entry.shared === undefined && liveStacks(sheet, entry) > 0;
    const cap = isLive ? entryValue(sheet, entry) : result;

    if (entry?.shared !== undefined) {
      result = walkShared(sheet, entry.shared, result);
    } else if (cap < result) {
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
  const how = sheet.how;
  let value = sheet.tables.base[stat] ?? 0;

  sheet.how = ADD;
  value = lists === undefined ? value : foldAdds(sheet, lists.adds, value);
  value = addDerived(sheet, stat, value);

  if (lists !== undefined) {
    sheet.how = MUL;
    value = foldMuls(sheet, lists.muls, value);
    sheet.how = MIN;
    value = foldMins(sheet, lists.mins, value);
  }

  sheet.how = how;

  return clampStat(sheet, stat, value);
};

/**
 * The product of the live scoped multipliers of a stat, in source order (1 when there are none): the part a read with
 * `scopedMuls: 'skip'` leaves out, for a caller that applies it at its own place in its own formula.
 */
export const scopedProduct = <Host>(sheet: Sheet<Host>, stat: number): number => {
  const how = sheet.how;

  sheet.how = MUL | SCOPED_ONLY;

  const value = walk(sheet, stat, 1);

  sheet.how = how;

  return value;
};
