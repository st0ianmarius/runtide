import { type CastHandle, NO_CAST } from './ids.ts';
import type { SpellCaster } from './spell-types.ts';

/**
 * What the spell system keeps on a caster (`SpellCaster.casts`): the handles of the casts it runs, in the order they
 * started, and one `auto` clock per auto spell of the registry. It is the system's; a game reads it through the
 * system (`castsOf`, `isCasting`) and never writes it.
 */
export interface CasterState {
  /** How many casts the caster runs now (in a stage: windup, channel or recover). */
  readonly count: number;
}

/** The caster state's record: a class for fast properties, filled by index and never shrunk (§I.5.4). */
export class CasterRecord implements CasterState {
  /** The handles of the running casts, valid up to `count`, in the order they started. */
  readonly handles: CastHandle[] = [];

  /** The seconds left on each `auto` spell's clock, by the spell's index among the registry's auto spells. */
  readonly clocks: Float64Array;

  /** The interval each `auto` spell last read at a cast, by the same index; 0 before its first. */
  readonly intervals: Float64Array;

  /** How many casts run. */
  count = 0;

  /** The bits of the interrupts the caster holds now (`spells.interrupt` until `endInterrupt`). */
  interrupts = 0;

  constructor(autoCount: number) {
    this.clocks = new Float64Array(autoCount);
    this.intervals = new Float64Array(autoCount);
  }

  /** Adds a cast's handle, last. */
  add(handle: CastHandle): void {
    this.handles[this.count] = handle;
    this.count += 1;
  }

  /** Writes the running casts' handles into `out` from index 0, in the order they started; returns how many. */
  copyInto(out: CastHandle[]): number {
    for (let i = 0; i < this.count; i++) {
      out[i] = this.handles[i] ?? NO_CAST;
    }

    return this.count;
  }

  /** Removes a cast's handle, keeping the others in order; false when it was not there. */
  remove(handle: CastHandle): boolean {
    let index = -1;

    for (let i = 0; i < this.count; i++) {
      if (this.handles[i] === handle) {
        index = i;
        break;
      }
    }

    if (index < 0) {
      return false;
    }

    for (let i = index + 1; i < this.count; i++) {
      this.handles[i - 1] = this.handles[i] ?? NO_CAST;
    }

    this.count -= 1;
    this.handles[this.count] = NO_CAST;

    return true;
  }
}

/** The record behind a caster's state; throws for a state the system did not make. */
export const recordOf = (caster: SpellCaster): CasterRecord => {
  const { casts } = caster;

  if (!(casts instanceof CasterRecord)) {
    throw new TypeError('A caster needs a state made by spells.createCasterState().');
  }

  return casts;
};
