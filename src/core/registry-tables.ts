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

const COLUMN_ARRAYS = {
  f64: Float64Array,
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  u16: Uint16Array,
  u8: Uint8Array
} as const;

/** Builds every typed column over the slots (a tombstone's slot is `undefined` and holds zero). */
export const buildColumns = <Def, Name extends string>(
  slots: readonly (Def | undefined)[],
  specs: Readonly<Record<Name, ColumnSpec<Def>>>
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
    }
  );
