import { type CastHandle, NO_CAST } from './ids.ts';
import type { SpellCaster, SpellId } from './spell-types.ts';

/**
 * What the spell system keeps on a caster (`SpellCaster.casts`): the handles of the casts it runs, in the order they
 * started, and a clock for each `auto` spell the caster has armed (`spells.arm`). It is the system's; a game reads it
 * through the system (`castsOf`, `isCasting`, `autoClock`) and never writes it.
 */
export interface CasterState {
  /** How many casts the caster runs now (in a stage: windup, channel or recover). */
  readonly count: number;
}

/** The caster state's record: a class for fast properties, filled by index and never shrunk. */
export class CasterRecord implements CasterState {
  /** The handles of the running casts, valid up to `count`, in the order they started. */
  readonly handles: CastHandle[] = [];

  /** The armed `auto` spells, in registry order: a caster steps only these (a mob's one swing, not the game's). */
  readonly autos: SpellId[] = [];

  /** The seconds left on each armed spell's clock, by its index in `autos`. */
  readonly clocks: number[] = [];

  /** How many casts run. */
  count = 0;

  /** The bits of the interrupts the caster holds now (`spells.interrupt` until `endInterrupt`). */
  interrupts = 0;

  /** The index of an armed spell in `autos`, or -1. */
  autoAt(spell: SpellId): number {
    return this.autos.indexOf(spell);
  }

  /** Arms a spell's clock with `seconds` left, in registry order; false when it was armed already. */
  arm(spell: SpellId, seconds: number): boolean {
    if (this.autos.includes(spell)) {
      return false;
    }

    const at = this.autos.findIndex((armed) => armed > spell);
    const index = at < 0 ? this.autos.length : at;

    this.autos.splice(index, 0, spell);
    this.clocks.splice(index, 0, seconds);

    return true;
  }

  /**
   * Sets an armed clock after its cast to the seconds it now has left. The cast may have armed or disarmed clocks (a
   * proc of the game's), so the clock is found again by its spell.
   */
  settle(spell: SpellId, left: number): void {
    const index = this.autos.indexOf(spell);

    if (index >= 0) {
      this.clocks[index] = left;
    }
  }

  /** The index of the first armed spell after `spell` in registry order, or how many are armed. */
  after(spell: SpellId): number {
    const { autos } = this;

    for (let i = 0; i < autos.length; i++) {
      const armed = autos[i];

      if (armed !== undefined && armed > spell) {
        return i;
      }
    }

    return autos.length;
  }

  /** Disarms a spell's clock; false when it was not armed. */
  disarm(spell: SpellId): boolean {
    const index = this.autos.indexOf(spell);

    if (index < 0) {
      return false;
    }

    this.autos.splice(index, 1);
    this.clocks.splice(index, 1);

    return true;
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
