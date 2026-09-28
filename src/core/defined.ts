/**
 * Anything but `undefined`. Containers that tell a missing entry from a present one by `undefined` (lists the draw
 * helpers read, the timing wheel, pools) take items of this type.
 */
export type Defined = NonNullable<unknown> | null;
