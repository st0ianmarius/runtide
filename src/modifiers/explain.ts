import { evaluateCurve } from './evaluate.ts';
import { derivedGain, entryValue } from './fold.ts';
import { liveStacks } from './live.ts';
import type { CompiledModifier, ModifierList } from './modifier.ts';
import { entriesInOrder } from './shared.ts';
import type { Entry, Sheet } from './sheet.ts';
import type { SourceId } from './sources.ts';
import { clampStat, stackedAdd, stackedMul } from './stacked.ts';
import type { StatId } from './stat-id.ts';

/**
 * A modifier explained as data: `{ kind: 'modifier', stat, op: 'mul', value: 1.3, when }`. The client
 * phrases it ("+30% damage while below 40% health") in its own words; nothing here is text.
 */
export interface ModifierExplanation extends CompiledModifier {
  /** The discriminant. */
  readonly kind: 'modifier';

  /** The stacks the explanation is for. */
  readonly stacks: number;

  /** What a plain value lands with at those stacks, or `undefined` for a value computed at each read. */
  readonly landed: number | undefined;
}

/** Explains one compiled modifier, at `stacks` stacks (1 by default). */
export const explainModifier = (modifier: CompiledModifier, stacks = 1): ModifierExplanation => {
  const { value, op } = modifier;
  const isLinear = modifier.stacking === 'linear';
  let landed: number | undefined;

  if (typeof value === 'number') {
    landed = op === 'mul' ? stackedMul({ isLinear }, value, stacks) : value;
    landed = op === 'add' ? stackedAdd(value, stacks) : landed;
  }

  return { ...modifier, kind: 'modifier', stacks, landed };
};

/** Explains every modifier of a list, in order. */
export const explainModifiers = (list: ModifierList, stacks = 1): readonly ModifierExplanation[] =>
  list.modifiers.map((modifier) => explainModifier(modifier, stacks));

/** One modifier's part in a stat's fold. */
export interface Contribution {
  /** The source (fold position) it folded at. */
  readonly source: SourceId;

  /** Its list's gate, or `undefined` for an ungated list. */
  readonly gate: number | undefined;

  /** The modifier. */
  readonly modifier: ModifierExplanation;

  /** The stacks it counted with, or 0 when it did not count for this read. */
  readonly stacks: number;

  /** What it landed with, or `undefined` when it did not count. */
  readonly value: number | undefined;
}

/** One derived term's part in a stat's fold. */
export interface DerivedContribution {
  /** A `derives` share or a rating conversion. */
  readonly kind: 'derives' | 'converts';

  /** The stat it follows. */
  readonly from: StatId;

  /** What it read: the followed stat's gain (`derives`) or its total (`converts`). */
  readonly input: number;

  /** What it added. */
  readonly value: number;
}

/** A stat's fold explained step by step as data, its total the float `resolve` returns for the same read. */
export interface StatExplanation {
  /** The discriminant. */
  readonly kind: 'stat';

  /** The stat. */
  readonly stat: StatId;

  /** Its base. */
  readonly base: number;

  /** Its additions, in fold order. */
  readonly adds: readonly Contribution[];

  /** Its derived terms, in order. */
  readonly derived: readonly DerivedContribution[];

  /** Its multipliers, in fold order. */
  readonly muls: readonly Contribution[];

  /** Its caps, in fold order. */
  readonly mins: readonly Contribution[];

  /** Its final clamp. */
  readonly clamp: {
    /** The floor. */
    readonly min: number;

    /** The ceiling. */
    readonly max: number;
  };

  /** The folded total. */
  readonly total: number;
}

/** The contribution of one entry, with its stacks for the current read and what it landed with. */
const contribution = <Host>(sheet: Sheet<Host>, entry: Entry<Host>, stacks: number): Contribution => {
  const { op } = entry.modifier;
  const raw = stacks > 0 ? entryValue(sheet, entry) : undefined;
  let value = raw;

  if (raw !== undefined && op !== 'min') {
    value = op === 'add' ? stackedAdd(raw, stacks) : stackedMul(entry, raw, stacks);
  }

  return {
    source: entry.source,
    gate: entry.gate < 0 ? undefined : entry.gate,
    modifier: explainModifier(entry.modifier, Math.max(1, stacks)),
    stacks,
    value
  };
};

/** The derived contributions of a stat, in the fold's order. */
const derivedOf = <Host>(sheet: Sheet<Host>, stat: StatId): DerivedContribution[] =>
  (sheet.tables.derivations[stat] ?? []).map((derivation) => {
    if (derivation.kind === 'derives') {
      const input = derivedGain(sheet, derivation);

      return {
        kind: 'derives',
        from: derivation.from,
        input,
        value: derivation.per * Math.max(0, input)
      };
    }

    const input = sheet.view.total(derivation.from);

    return {
      kind: 'converts',
      from: derivation.from,
      input,
      value: evaluateCurve(derivation.curve, input, sheet.view)
    };
  });

/** The contributions of a list of entries, in fold order. */
const contributions = <Host>(sheet: Sheet<Host>, entries: readonly Entry<Host>[]): Contribution[] =>
  entries.map((entry) => contribution(sheet, entry, liveStacks(sheet, entry)));

/** The fold's total from its explained parts, in the fold's own float order. */
const totalOf = (parts: Omit<StatExplanation, 'kind' | 'stat' | 'clamp' | 'total'>): number => {
  let value = parts.base;

  for (const part of [...parts.adds, ...parts.derived]) {
    value += part.value ?? 0;
  }

  for (const part of parts.muls) {
    value *= part.value ?? 1;
  }

  for (const part of parts.mins) {
    if (part.value !== undefined && part.value < value) {
      value = part.value;
    }
  }

  return value;
};

/** Explains a built sheet's stat for its current read; the system wraps it as `explainStat`. */
export const explainSheetStat = <Host>(sheet: Sheet<Host>, stat: StatId): StatExplanation => {
  const parts = {
    base: sheet.bases[stat] ?? 0,
    adds: contributions(sheet, entriesInOrder(sheet, stat, 'adds')),
    derived: derivedOf(sheet, stat),
    muls: contributions(sheet, entriesInOrder(sheet, stat, 'muls')),
    mins: contributions(sheet, entriesInOrder(sheet, stat, 'mins'))
  };

  const clamp = {
    min: sheet.tables.min[stat] ?? -Infinity,
    max: sheet.tables.max[stat] ?? Infinity
  };

  return { kind: 'stat', stat, ...parts, clamp, total: clampStat(sheet, stat, totalOf(parts)) };
};
