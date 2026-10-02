import type { BlowSpec } from './blow.ts';
import { checkSkippable } from './compile.ts';
import type { DamageTypes } from './damage-types.ts';
import type { DamageEngine } from './engine.ts';

/** No names. */
const NO_NAMES: readonly string[] = Object.freeze([]);

/** Throws for an outcome row a blow names to skip that the system's roll table does not have. */
const checkSkips = <G extends DamageTypes>(engine: DamageEngine<G>, skips: readonly string[]): void => {
  const names = engine.rolls?.names ?? NO_NAMES;

  for (const name of skips) {
    if (!names.includes(name)) {
      throw new RangeError(
        `Damage system: a blow cannot skip the outcome row ${name}: the roll table has ${names.length > 0 ? names.join(', ') : 'no rows'}.`
      );
    }
  }
};

/**
 * Checks the names a blow (or a damage proc, at load) skips: every `skips` name is an outcome row of the system's roll
 * table, and every `bypass` name a stage, or a group of stages, before `health`. Throws a `RangeError` otherwise, so a
 * typo (`skips: ['blok']`) fails where it is written instead of silently rolling the row.
 */
export const checkBlowSpec = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  spec: Pick<BlowSpec<G>, 'skips' | 'bypass'>
): void => {
  if (spec.skips !== undefined) {
    checkSkips(engine, spec.skips);
  }

  for (const stage of spec.bypass ?? NO_NAMES) {
    checkSkippable(engine.order, [stage, 'A blow']);
  }
};
