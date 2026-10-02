import { recordOf } from './records.ts';

/** The element type of a typed hot-field column. */
export type ColumnType = 'f64' | 'f32' | 'i32' | 'u32' | 'u16' | 'u8';

/** A typed hot-field column: one number per registry id, read by hot loops instead of the definitions. */
export type Column = Float64Array | Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

/** How to build one typed column from the definitions. */
export interface ColumnSpec<Def> {
  /** The element type of the column. */
  readonly type: ColumnType;

  /**
   * Reads the column's number from one definition; a tombstone's slot holds zero. An integer type takes a whole number
   * and a float type any number but NaN, or the build throws, since a typed array would store either as something else
   * (NaN and 1.5 in `i32` as 0 and 1). A whole number outside an integer type's range wraps as a typed array wraps it
   * (300 in `u8` is 44, -1 is 255), and `f32` rounds to its precision (past its range to an infinity): a game keeps
   * its values in range, or checks them before the build.
   */
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

/** Whether a column type holds integers, which a fraction, NaN or an infinity would silently turn into another. */
const isInteger = (type: ColumnType): boolean => type !== 'f64' && type !== 'f32';

/**
 * One definition's value for a column, checked against the column's type: a whole number for an integer type, any
 * number but NaN for a float type.
 */
const checkValue = (name: string, type: ColumnType, slot: number, value: number): number => {
  if (isInteger(type) ? !Number.isInteger(value) : Number.isNaN(value)) {
    const holds = isInteger(type) ? 'whole numbers' : 'any number but NaN';

    throw new RangeError(`Column ${name} (${type}) holds ${holds}; slot ${slot} gives ${value}.`);
  }

  return value;
};

/**
 * Builds every typed column over the slots (a tombstone's slot is `undefined` and holds zero), at load. Throws a
 * `RangeError` naming the column and slot for a value its type would store as something else (see `ColumnSpec.of`).
 */
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
          column[index] = checkValue(name, spec.type, index, spec.of(def));
        }
      }

      return column;
    }
  );
