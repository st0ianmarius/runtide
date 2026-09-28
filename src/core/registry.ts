import type { Bitset } from './bitset.ts';
import { type Id, toId } from './ids.ts';
import { deepFreeze, recordOf } from './records.ts';
import {
  buildColumns,
  buildHookBits,
  buildHookTables,
  type Column,
  type ColumnSpec,
  type HookKey,
  type HookTables,
} from './registry-tables.ts';

/** The marker of a retired definition: it keeps its slot, and so every later id, but can no longer be used. */
export interface Tombstone {
  /** Always true: the slot is retired. */
  readonly isRetired: true;
}

/** Put in a registry in place of a retired definition, so the definitions after it keep their ids (§I.5). */
export const TOMBSTONE: Tombstone = Object.freeze({ isRetired: true });

/**
 * Whether a registry entry is a live definition: anything but the tombstone. `Def` is named only by the result, since
 * the compiler cannot see that an entry of `Defs` other than the tombstone is a `DefOf<Defs>`.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isLive = <Def extends object>(entry: object): entry is Def => entry !== TOMBSTONE;

/** The definitions of a registry's entries, without the tombstones. */
export type DefOf<Defs> = Exclude<Defs[keyof Defs], Tombstone>;

/** What a registry is built with, beyond its definitions. */
export interface RegistryOptions<Kind extends string, Def, Columns extends string, Hooks extends HookKey<Def>> {
  /** The registry's kind, which brands its ids (`Id<'spells'>`) and names it in error messages. */
  readonly kind?: Kind;

  /**
   * The pinned order of the names, when it is not the key order: a derived registry pins its own append-only order
   * this way (§II.6 K5). Every definition's name must be listed; a listed name with no definition is a tombstone.
   */
  readonly order?: readonly string[];

  /**
   * Normalises a definition into the kind's one object shape, every optional field present (§I.5.4). It must return a
   * new object; the definition itself is never changed.
   */
  readonly normalize?: (def: Def) => Def;

  /** Typed hot-field columns to build, by column name. */
  readonly columns?: Readonly<Record<Columns, ColumnSpec<Def>>>;

  /** The hooks to build dispatch tables and `has` bitsets for. */
  readonly hooks?: readonly Hooks[];

  /** Whether to deep-freeze every definition, to catch mutation; true by default, off in a production build. */
  readonly freeze?: boolean;
}

/**
 * An ordered registry of plain-object definitions (§I.5.2, §I.5.4). Each name gets a dense id, its position; lookups
 * by id are array reads. Append-only: a retired entry keeps its slot as a tombstone.
 */
export interface Registry<Kind extends string, Name extends string, Def, Columns extends string, Hooks extends string> {
  /** The registry's kind, as passed in its options (`registry` when none was), for messages and tools. */
  readonly kind: string;

  /** The id of every name, resolved at load or in authoring code, never per tick. */
  readonly id: Readonly<Record<Name, Id<Kind>>>;

  /** The number of slots, tombstones included: every id is below it. */
  readonly size: number;

  /** The name of every slot, in id order. */
  readonly names: readonly string[];

  /** The normalised definition of every slot, in id order; `undefined` for a tombstone. */
  readonly defs: readonly (Def | undefined)[];

  /** The ids of the live (not retired) entries, in order. */
  readonly ids: readonly Id<Kind>[];

  /** The name an id was registered under: a developer string for code, logs and validation, never for players. */
  readonly name: (id: Id<Kind>) => string;

  /** The normalised definition of a live id. Throws for a tombstone or an id outside the registry. */
  readonly get: (id: Id<Kind>) => Def;

  /** Whether an id's slot is a tombstone. Throws for an id outside the registry. */
  readonly isRetired: (id: Id<Kind>) => boolean;

  /** The typed hot-field columns, each indexed by id. */
  readonly columns: Readonly<Record<Columns, Column>>;

  /** The dispatch table of each named hook, indexed by id. */
  readonly hooks: HookTables<Def, Extract<Hooks, HookKey<Def>>>;

  /** The bitset of ids that have each named hook. */
  readonly has: Readonly<Record<Hooks, Bitset>>;
}

/** An integer-like key, which object key order would move ahead of the others. */
const INDEX_KEY = /^(?:0|[1-9]\d*)$/;

/** The names in id order: the pinned order when given (checked against the definitions), else the key order. */
const resolveOrder = (keys: readonly string[], order: readonly string[] | undefined, kind: string): string[] => {
  for (const key of keys) {
    if (INDEX_KEY.test(key)) {
      throw new RangeError(`Registry ${kind}: name ${key} looks like an index, which breaks key order.`);
    }
  }

  if (order === undefined) {
    return [...keys];
  }

  const listed = new Set(order);
  const missing = keys.filter((key) => !listed.has(key));

  if (missing.length > 0 || listed.size !== order.length) {
    throw new RangeError(`Registry ${kind}: the pinned order must list every name once; missing ${missing.join()}.`);
  }

  return [...order];
};

/** Builds the dense slots: each live definition frozen (when asked) and normalised; `undefined` for a tombstone. */
const buildSlots = <Def extends object, Hooks extends HookKey<Def>>(
  names: readonly string[],
  lookup: (name: string) => object | undefined,
  options: RegistryOptions<string, Def, string, Hooks>,
): (Def | undefined)[] =>
  names.map((name) => {
    const def = lookup(name);

    if (def === undefined || !isLive<Def>(def)) {
      return undefined;
    }

    const normalised = options.normalize?.(def) ?? def;

    if (options.freeze ?? true) {
      deepFreeze(def);
      deepFreeze(normalised);
    }

    return normalised;
  });

/** The lookups over the dense slots, which check every id they are handed. */
const createLookups = <Kind extends string, Def>(
  kind: string,
  names: readonly string[],
  slots: readonly (Def | undefined)[],
) => {
  const slotOf = (id: Id<Kind>): number => {
    if (!Number.isInteger(id) || id < 0 || id >= slots.length) {
      throw new RangeError(`Registry ${kind}: ${id} is not an id of this registry.`);
    }

    return id;
  };

  return {
    name: (id: Id<Kind>): string => names[slotOf(id)] ?? '',
    isRetired: (id: Id<Kind>): boolean => slots[slotOf(id)] === undefined,

    get: (id: Id<Kind>): Def => {
      const def = slots[slotOf(id)];

      if (def === undefined) {
        throw new RangeError(`Registry ${kind}: ${names[id] ?? id} is retired.`);
      }

      return def;
    },
  };
};

/**
 * Creates a registry from `{ name: def, … }` (§I.5.2): each name gets a dense id by key order (or by the pinned
 * `order`), `TOMBSTONE` keeps a retired slot, and the definitions are normalised, frozen in development, and copied
 * into typed columns, hook dispatch tables and `has` bitsets. Hooks are stored as given and may be called detached.
 */
export const createRegistry = <
  Defs extends Readonly<Record<string, object>>,
  Kind extends string = string,
  Columns extends string = never,
  Hooks extends HookKey<DefOf<Defs>> = never,
>(
  defs: Defs,
  options: RegistryOptions<Kind, DefOf<Defs>, Columns, Hooks> = {},
): Registry<Kind, Extract<keyof Defs, string>, DefOf<Defs>, Columns, Hooks> => {
  type Def = DefOf<Defs>;
  type Name = Extract<keyof Defs, string>;

  const kind = options.kind ?? 'registry';
  const keys = Object.keys(defs).filter((key): key is Name => Object.hasOwn(defs, key));
  const names = Object.freeze(resolveOrder(keys, options.order, kind));
  const known = new Set<string>(keys);
  const isName = (name: string): name is Name => known.has(name);

  const slots = Object.freeze(
    buildSlots<Def, Hooks>(names, (name) => (isName(name) ? defs[name] : undefined), options),
  );

  const hookNames = options.hooks ?? [];
  const hooks = buildHookTables<Def, Hooks>(slots, hookNames);

  return Object.freeze({
    kind,
    id: recordOf(keys, (key) => toId<Kind>(names.indexOf(key))),
    size: slots.length,
    names,
    defs: slots,
    ids: Object.freeze(slots.flatMap((def, index) => (def === undefined ? [] : [toId<Kind>(index)]))),
    ...createLookups(kind, names, slots),
    columns: buildColumns(
      slots,
      options.columns ?? recordOf<Columns, ColumnSpec<Def>>([], () => ({ type: 'u8', of: () => 0 })),
    ),
    hooks,
    has: buildHookBits(hooks, hookNames),
  });
};

/**
 * Checks that a registry's order still starts with the pinned names, in order: the append-only rule (§I.5), which a
 * consuming game holds in a test. Throws naming the first slot that moved.
 */
export const checkOrder = (registry: { readonly names: readonly string[] }, pinned: readonly string[]): void => {
  const moved = pinned.findIndex((name, index) => registry.names[index] !== name);

  if (moved >= 0) {
    throw new RangeError(`Slot ${moved} was ${pinned[moved]} and is now ${registry.names[moved] ?? 'missing'}.`);
  }
};
