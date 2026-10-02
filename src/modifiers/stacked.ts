import type { Sheet } from './sheet.ts';

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

/** An add at `stacks` stacks: the authored float at one stack or fewer, else `value × stacks`. */
export const stackedAdd = (value: number, stacks: number): number => (stacks <= 1 ? value : value * stacks);

/**
 * A mul at `stacks` stacks: the authored float at one stack or fewer, else `value ^ stacks`, or for linear stacking
 * `1 + perStack × stacks` with an authored rise per stack, else `1 + (value − 1) × stacks`.
 */
export const stackedMul = (
  entry: { readonly isLinear: boolean; readonly perStack?: number | undefined },
  value: number,
  stacks: number
): number => {
  if (stacks <= 1) {
    return value;
  }

  if (!entry.isLinear) {
    return value ** stacks;
  }

  return entry.perStack === undefined ? 1 + (value - 1) * stacks : 1 + entry.perStack * stacks;
};
