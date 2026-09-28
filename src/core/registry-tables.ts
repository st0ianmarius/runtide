import { type Bitset, createBitset } from './bitset.ts';
import { recordOf } from './records.ts';

/** The element type of a typed hot-field column. */
export type ColumnType = 'f64' | 'f32' | 'i32' | 'u32' | 'u16' | 'u8';

/** A typed hot-field column: one number per registry id, read by hot loops instead of the definitions. */
export type Column = Float64Array | Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

/** How to build one typed column from the definitions. */
export interface ColumnSpec<Def> {
  /** The element type of the column. */
  readonly type: ColumnType;

  /** Reads the column's number from one definition; a tombstone's slot holds zero. */
  readonly of: (def: Def) => number;
}

/** Any hook: a standalone function the framework may call detached. */
export type AnyHook = (...args: never[]) => unknown;

/** The keys of `Def` whose values are hooks (functions), optional or not. */
export type HookKey<Def> = {
  [Key in keyof Def]-?: NonNullable<Def[Key]> extends AnyHook ? Key : never;
}[keyof Def] &
  string;

/** Per-hook dispatch tables: for each hook, an array indexed by id holding the hook or `undefined`. */
export type HookTables<Def, Hooks extends HookKey<Def>> = {
  readonly [Hook in Hooks]: readonly (NonNullable<Def[Hook]> | undefined)[];
};

/** Per-hook bitsets of the ids that have the hook, so a missing hook costs one bit test. */
export type HookBits<Hooks extends string> = Readonly<Record<Hooks, Bitset>>;

const COLUMN_ARRAYS = {
  f64: Float64Array,
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  u16: Uint16Array,
  u8: Uint8Array,
} as const;

/** Builds every typed column over the slots (a tombstone's slot is `undefined` and holds zero). */
export const buildColumns = <Def, Name extends string>(
  slots: readonly (Def | undefined)[],
  specs: Readonly<Record<Name, ColumnSpec<Def>>>,
): Readonly<Record<Name, Column>> =>
  recordOf(
    Object.keys(specs).filter((key): key is Name => Object.hasOwn(specs, key)),
    (name) => {
      const spec = specs[name];
      const column = new COLUMN_ARRAYS[spec.type](slots.length);

      for (const [index, def] of slots.entries()) {
        if (def !== undefined) {
          column[index] = spec.of(def);
        }
      }

      return column;
    },
  );

/** Whether a record built from hook names holds a table for every hook, which types it as the dispatch tables. */
const isHookTables = <Def, Hooks extends HookKey<Def>>(
  tables: Readonly<Record<string, readonly unknown[]>>,
  hooks: readonly Hooks[],
): tables is HookTables<Def, Hooks> => hooks.every((hook) => Object.hasOwn(tables, hook));

/** Builds the dispatch table of every named hook, indexed by id. Throws when a named field holds a non-function. */
export const buildHookTables = <Def, Hooks extends HookKey<Def>>(
  slots: readonly (Def | undefined)[],
  hooks: readonly Hooks[],
): HookTables<Def, Hooks> => {
  const tables = recordOf(hooks, (hook) =>
    Object.freeze(
      slots.map((def) => {
        const value = def?.[hook];

        if (value !== undefined && typeof value !== 'function') {
          throw new TypeError(`Hook ${hook} must be a function.`);
        }

        return value;
      }),
    ),
  );

  if (!isHookTables<Def, Hooks>(tables, hooks)) {
    throw new Error('A hook table was lost while it was built.');
  }

  return tables;
};

/** Builds the `has` bitset of every named hook from its dispatch table. */
export const buildHookBits = <Hooks extends string>(
  tables: Readonly<Record<Hooks, readonly unknown[]>>,
  hooks: readonly Hooks[],
): HookBits<Hooks> =>
  recordOf(hooks, (hook) => createBitset(tables[hook].flatMap((value, index) => (value === undefined ? [] : [index]))));
