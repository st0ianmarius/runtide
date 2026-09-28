import type { CompiledModifier, CompiledValue, ModifierList } from './modifier.ts';
import { type CompiledStat, type Entry, FROM_HOST, FROM_STAT, PLAIN, type Sheet } from './sheet.ts';
import type { SourceId } from './sources.ts';

/** The value fields of an entry. */
interface ValueFields {
  readonly value: number;
  readonly valueKind: number;
  readonly valueStat: number;
  readonly per: number;
  readonly neutral: number;
  readonly cap: number;
  readonly readId: number;
  readonly readArg: number;
}

/** The value fields of a compiled value: a plain number, a followed stat, or a game value read. */
const valueFields = (value: CompiledValue): ValueFields => {
  const plain = {
    value: 0,
    valueKind: PLAIN,
    valueStat: -1,
    per: 0,
    neutral: 0,
    cap: Infinity,
    readId: -1,
    readArg: 0,
  };

  if (typeof value === 'number') {
    return { ...plain, value };
  }

  if (value.kind === 'stat') {
    const { stat, per, neutral } = value;

    return { ...plain, valueKind: FROM_STAT, valueStat: stat, per, neutral, cap: value.cap ?? Infinity };
  }

  return { ...plain, valueKind: FROM_HOST, readId: value.value, readArg: value.arg };
};

/** The fold entry of one compiled modifier from one source, every field present (one hidden class, §I.5.4). */
const entryOf = <Host>(
  sheet: Sheet<Host>,
  modifier: CompiledModifier,
  at: { readonly source: SourceId; readonly gate: number },
): Entry<Host> => {
  const fields = valueFields(modifier.value);
  const { when } = modifier;

  return {
    value: fields.value,
    valueKind: fields.valueKind,
    valueStat: fields.valueStat,
    per: fields.per,
    neutral: fields.neutral,
    cap: fields.cap,
    read: fields.readId < 0 ? undefined : sheet.tables.reads[fields.readId],
    readArg: fields.readArg,
    test: when === undefined ? undefined : sheet.tables.tests[when.condition],
    testArg: when === undefined ? 0 : when.arg,
    scope: modifier.scope ?? -1,
    source: at.source,
    gate: at.gate,
    isLinear: modifier.stacking === 'linear',
    modifier,
  };
};

/** A stat's lists while they are gathered. */
interface Gathering<Host> {
  readonly adds: Entry<Host>[];
  readonly muls: Entry<Host>[];
  readonly mins: Entry<Host>[];
}

/** Empty lists for one stat. */
const gathering = <Host>(): Gathering<Host> => ({ adds: [], muls: [], mins: [] });

/** The list of a stat an op goes into. */
const listFor = <Host>(into: Gathering<Host>, op: CompiledModifier['op']): Entry<Host>[] => {
  if (op === 'add') {
    return into.adds;
  }

  return op === 'mul' ? into.muls : into.mins;
};

/** Throws when stat-valued modifiers and derived terms make a stat follow itself. */
const checkAcyclic = <Host>(sheet: Sheet<Host>, lists: readonly Gathering<Host>[]): void => {
  const follows = (stat: number): number[] => [
    ...(sheet.tables.derivations[stat] ?? []).map((derivation) => derivation.from),
    ...[...(lists[stat]?.adds ?? []), ...(lists[stat]?.muls ?? []), ...(lists[stat]?.mins ?? [])]
      .filter((entry) => entry.valueKind === FROM_STAT)
      .map((entry) => entry.valueStat),
  ];

  const state = new Uint8Array(sheet.tables.base.length);

  const visit = (stat: number): void => {
    if (state[stat] === 1) {
      throw new RangeError(`Stat ${sheet.tables.nameOf(stat)} follows itself through stat-valued modifiers.`);
    }

    if (state[stat] === 0) {
      state[stat] = 1;
      for (const next of follows(stat)) {
        visit(next);
      }

      state[stat] = 2;
    }
  };

  for (const stat of lists.keys()) {
    visit(stat);
  }
};

/**
 * Rebuilds a sheet's compiled cache: every stat's adds, muls and mins, source by source in fold order (within a
 * source, the sheet's own lists, then the lists shared by every sheet), each list in authored order.
 */
export const buildSheet = <Host>(sheet: Sheet<Host>, shared: readonly (readonly ModifierList[])[]): void => {
  const lists = Array.from(sheet.tables.base, () => gathering<Host>());

  for (const source of sheet.tables.sourceIds) {
    for (const list of [...(sheet.lists[source] ?? []), ...(shared[source] ?? [])]) {
      for (const modifier of list.modifiers) {
        const into = lists[modifier.stat] ?? gathering<Host>();

        listFor(into, modifier.op).push(entryOf(sheet, modifier, { source, gate: list.gate ?? -1 }));
      }
    }
  }

  checkAcyclic(sheet, lists);

  sheet.compiled = lists.map((stat): CompiledStat<Host> | undefined =>
    stat.adds.length + stat.muls.length + stat.mins.length === 0 ? undefined : Object.freeze(stat),
  );

  sheet.isDirty = false;
  sheet.compiles += 1;
};
