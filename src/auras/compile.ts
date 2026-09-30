import { type Bitset, createBitset, stepsUntil } from '../core/index.ts';
import type { Modifier, ModifierList, SourceId, SourceTable, StatId, StatTable } from '../modifiers/index.ts';
import type { AuraChange, AuraDef } from './aura-def.ts';
import type { AuraTagId, AuraTypes } from './aura-types.ts';
import type { AuraRegistry } from './define-auras.ts';
import type { AuraTagTable } from './tags.ts';

/** The lifecycle changes, by code. */
export const CHANGES: readonly AuraChange[] = ['applied', 'refreshed', 'expired', 'removed', 'stateEntered'];

/**
 * A clock auras count on: its fixed step (a `SimClock` is one). An aura's life is a stamp on its bearer's count of the
 * clock's steps, set once and never touched per tick.
 */
export interface AuraClock {
  /** The fixed step, in seconds, of one tick of this clock. */
  readonly dt: number;
}

/** What an aura system needs from a modifier system: compiling gated lists and sharing them at a fold position. */
export interface AuraModifiers<G extends AuraTypes> {
  /** The game's stat table. */
  readonly stats: StatTable<G['stat']>;

  /** The game's modifier sources. */
  readonly sources: SourceTable<G['source']>;

  /** Compiles a gated modifier list (a method, so a system over narrower names fits a wider aura game). */
  compile(
    modifiers: readonly Modifier<G['stat'], G['condition'], G['valueKind']>[],
    options?: {
      /** The gate (the aura id). */
      readonly gate?: number;

      /** What is compiled, for messages. */
      readonly what?: string;
    },
  ): ModifierList;

  /** Shares lists at one source in every sheet. */
  share(source: SourceId, lists: readonly ModifierList[]): void;
}

/** What the tables are compiled from. */
export interface CompileInput<G extends AuraTypes> {
  /** The aura registry. */
  readonly registry: AuraRegistry<G>;

  /** The tag table. */
  readonly tags: AuraTagTable<G['tag']>;

  /** The clocks, by name, in declaration order. */
  readonly clocks: Readonly<Record<G['clock'], AuraClock>>;

  /** The modifier system, when auras carry modifiers. */
  readonly modifiers?: AuraModifiers<G> | undefined;

  /** The default fold source. */
  readonly fold?: G['source'] | undefined;

  /** The bearer states `removedOn` names, at most 32. */
  readonly states?: readonly G['state'][] | undefined;
}

/** Everything the system reads per aura id, resolved from names at load. */
export interface AuraTables {
  /** The tags each aura grants. */
  readonly tagBits: readonly Bitset[];

  /** The immunities of each aura, `undefined` for none. */
  readonly blockedBy: readonly (Bitset | undefined)[];

  /** The tags each aura grants, in declared order. */
  readonly tagIds: readonly (readonly AuraTagId[])[];

  /** The immunities of each aura, in declared order. */
  readonly blockedByIds: readonly (readonly AuraTagId[])[];

  /** The tags each aura cleanses, in declared order. */
  readonly removes: readonly (readonly AuraTagId[])[];

  /** The lifetime clock of each aura. */
  readonly clock: Uint8Array;

  /** The beat clock of each aura, -1 without a beat. */
  readonly beatClock: Int16Array;

  /** The `removedOn` states of each aura, as a mask. */
  readonly removedOn: Uint32Array;

  /** The ticks the definition's own fixed length takes on its clock, -1 when it has none. */
  readonly fixedSteps: Float64Array;

  /** The compiled modifier list of each aura, gated on its id. */
  readonly lists: readonly (ModifierList | undefined)[];

  /** The rescale stat of each aura, `undefined` for none. */
  readonly rescaleStat: readonly (StatId | undefined)[];

  /** The rescale edges of each aura, as a mask over change codes. */
  readonly rescaleOn: Uint8Array;

  /** The clocks, by id. */
  readonly clocks: readonly AuraClock[];

  /** The clock names, by id. */
  readonly clockNames: readonly string[];

  /** The state names, by bit. */
  readonly stateNames: readonly string[];
}

/** The id a record of ids gives a name, or a clear error. */
const idIn = <Id extends number>(ids: Readonly<Record<string, Id>>, name: string, what: string): Id => {
  const id = Object.hasOwn(ids, name) ? ids[name] : undefined;

  if (id === undefined) {
    throw new RangeError(`${what}: there is no ${name}.`);
  }

  return id;
};

/** The tag ids of a list of tag names. */
const tagIds = <G extends AuraTypes>(input: CompileInput<G>, names: readonly string[], what: string): AuraTagId[] =>
  names.map((name) => idIn(input.tags.id, name, `${what} tag`));

/** The index of a clock name. */
const clockId = (names: readonly string[], name: string, what: string): number => {
  const id = names.indexOf(name);

  if (id < 0) {
    throw new RangeError(`${what}: there is no clock ${name}.`);
  }

  return id;
};

/** The state mask of a `removedOn` list. */
const stateMask = (names: readonly string[], removedOn: readonly string[], what: string): number => {
  let mask = 0;

  for (const name of removedOn) {
    const bit = names.indexOf(name);

    if (bit < 0) {
      throw new RangeError(`${what}: there is no bearer state ${name}.`);
    }

    mask |= 1 << bit;
  }

  return mask;
};

/** Compiles one aura's modifier list and notes its fold source. */
const compileList = <G extends AuraTypes>(
  input: CompileInput<G>,
  at: { readonly id: number; readonly def: AuraDef<G>; readonly what: string },
  bySource: Map<SourceId, ModifierList[]>,
): ModifierList | undefined => {
  const { def, what } = at;
  const { modifiers } = input;

  if ((def.modifiers?.length ?? 0) === 0) {
    return undefined;
  }

  const fold = def.fold ?? input.fold;

  if (modifiers === undefined || fold === undefined) {
    throw new RangeError(`${what}: modifiers need the system's modifier system and a fold source.`);
  }

  const source = idIn(modifiers.sources.id, fold, `${what} fold`);
  const list = modifiers.compile(def.modifiers ?? [], { gate: at.id, what });

  bySource.set(source, [...(bySource.get(source) ?? []), list]);

  return list;
};

/** The rescale stat id of an aura, `undefined` for none. */
const rescaleStatOf = <G extends AuraTypes>(
  input: CompileInput<G>,
  def: AuraDef<G>,
  what: string,
): StatId | undefined => {
  if (def.rescale === undefined) {
    return undefined;
  }

  const stat = input.modifiers?.stats.index.idOf(def.rescale.stat);

  if (stat === undefined) {
    throw new RangeError(`${what}: a rescale needs the modifier system and a known stat.`);
  }

  return stat;
};

/** An empty set of tables, one slot per aura id. */
const emptyTables = <G extends AuraTypes>(input: CompileInput<G>, size: number) => ({
  tagBits: Array.from({ length: size }, () => createBitset()),
  blockedBy: Array.from<Bitset | undefined>({ length: size }),
  tagIds: Array.from<readonly AuraTagId[]>({ length: size }).fill([]),
  blockedByIds: Array.from<readonly AuraTagId[]>({ length: size }).fill([]),
  removes: Array.from<readonly AuraTagId[]>({ length: size }).fill([]),
  clock: new Uint8Array(size),
  beatClock: new Int16Array(size).fill(-1),
  removedOn: new Uint32Array(size),
  fixedSteps: new Float64Array(size).fill(-1),
  lists: Array.from<ModifierList | undefined>({ length: size }),
  rescaleStat: Array.from<StatId | undefined>({ length: size }),
  rescaleOn: new Uint8Array(size),
  clocks: Object.values<AuraClock>(input.clocks),
  clockNames: Object.keys(input.clocks),
  stateNames: [...(input.states ?? [])],
});

/** One aura's slot being filled. */
interface Slot<G extends AuraTypes> {
  /** Its id. */
  readonly id: number;

  /** Its definition. */
  readonly def: AuraDef<G>;

  /** Its name, for messages. */
  readonly what: string;
}

/** Fills the tag slots of one aura: what it grants, what turns it away, what it cleanses. */
const compileTags = <G extends AuraTypes>(
  input: CompileInput<G>,
  tables: ReturnType<typeof emptyTables>,
  slot: Slot<G>,
): void => {
  const { id, def, what } = slot;
  const tags = tagIds(input, def.tags ?? [], what);
  const blockedBy = tagIds(input, def.blockedBy ?? [], what);

  tables.tagIds[id] = Object.freeze(tags);
  tables.blockedByIds[id] = Object.freeze(blockedBy);
  tables.tagBits[id] = createBitset(tags);
  tables.blockedBy[id] = blockedBy.length > 0 ? createBitset(blockedBy) : undefined;
  tables.removes[id] = Object.freeze(tagIds(input, def.removes ?? [], what));
};

/** Fills the slot of one aura. */
const compileOne = <G extends AuraTypes>(
  input: CompileInput<G>,
  tables: ReturnType<typeof emptyTables>,
  at: { readonly id: number; readonly def: AuraDef<G>; readonly bySource: Map<SourceId, ModifierList[]> },
): void => {
  const { id, def } = at;
  const what = `Aura ${input.registry.names[id] ?? id}`;
  const clock = clockId(tables.clockNames, def.clock ?? tables.clockNames[0] ?? '', what);
  const rule = tables.clocks[clock];

  compileTags(input, tables, { id, def, what });
  tables.clock[id] = clock;
  tables.removedOn[id] = stateMask(tables.stateNames, def.removedOn ?? [], what);
  tables.lists[id] = compileList(input, { id, def, what }, at.bySource);
  tables.rescaleStat[id] = rescaleStatOf(input, def, what);
  tables.rescaleOn[id] = (def.rescale?.on ?? []).reduce((mask, change) => mask | (1 << CHANGES.indexOf(change)), 0);

  if (def.periodic !== undefined) {
    tables.beatClock[id] = clockId(tables.clockNames, def.periodic.clock ?? tables.clockNames[clock] ?? '', what);
  }

  if (typeof def.duration === 'number' && rule !== undefined) {
    tables.fixedSteps[id] = stepsUntil(def.duration, rule.dt);
  }
};

/**
 * Compiles a registry against the game's tags, clocks, states and modifier system, at load: every name to its id,
 * every modifier list compiled with its aura's id as its gate and shared at its fold position, in registry order.
 */
export const compileAuras = <G extends AuraTypes>(input: CompileInput<G>): AuraTables => {
  const { registry } = input;
  const tables = emptyTables(input, registry.size);
  const bySource = new Map<SourceId, ModifierList[]>();

  if (tables.clockNames.length === 0 || tables.clockNames.length > 255) {
    throw new RangeError('An aura system needs from 1 to 255 clocks.');
  }

  if (tables.stateNames.length > 32) {
    throw new RangeError('An aura system declares at most 32 bearer states.');
  }

  for (const id of registry.ids) {
    compileOne(input, tables, { id, def: registry.get(id), bySource });
  }

  for (const [source, lists] of bySource) {
    input.modifiers?.share(source, lists);
  }

  return tables;
};
