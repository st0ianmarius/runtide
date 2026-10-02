import { stepsUntil } from '../core/index.ts';
import type { Cast } from './cast.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import type { SpellCaster, SpellId, SpellTypes } from './spell-types.ts';

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

  /** Each armed clock's seconds as it was last set, by its index in `autos`. */
  readonly lefts: number[] = [];

  /** The caster's step on which each armed clock was last set. */
  readonly sets: number[] = [];

  /** The caster's step on which each armed clock runs out (`stepsUntil` its seconds from when it was set). */
  readonly dues: number[] = [];

  /** How many times its clocks were stepped: they count on the caster's own steps, so one not stepped waits. */
  steps = 0;

  /** At or below the earliest `dues`: a step before it has nothing to run out, and costs a compare. */
  nextDue = Number.POSITIVE_INFINITY;

  /** The spell whose clock the running step walks now; −1 outside a step. */
  walking = -1;

  /** How many casts run. */
  count = 0;

  /** The bits of the interrupts the caster holds now (`spells.interrupt` until `endInterrupt`). */
  interrupts = 0;

  /** How many times the caster holds each interrupt, by its bit's position: it ends as the last of them does. */
  readonly interruptCounts: number[] = [];

  /** The tick its last cast started on, and how many started on it: each cast's ordinal among the tick's. */
  lastTick = Number.NaN;
  started = 0;

  /**
   * The ordinal of a cast starting on `tick`: 0 for the tick's first, then 1, 2 and on. Asking takes nothing, so a
   * check, a refusal or a cooldown read shares the ordinal of the next cast that starts (`countStart`).
   */
  ordinalAt(tick: number): number {
    if (tick !== this.lastTick) {
      this.lastTick = tick;
      this.started = 0;
    }

    return this.started;
  }

  /** Counts a cast started on the tick `ordinalAt` last asked about, which moves the next one's ordinal on. */
  countStart(): void {
    this.started += 1;
  }

  /** The index of an armed spell in `autos`, or -1. */
  autoAt(spell: SpellId): number {
    return this.autos.indexOf(spell);
  }

  /** Arms a spell's clock with `seconds` left on steps of `dt`, in registry order; false when it was armed already. */
  arm(spell: SpellId, seconds: number, dt: number): boolean {
    if (this.autos.includes(spell)) {
      return false;
    }

    const at = this.autos.findIndex((armed) => armed > spell);
    const index = at < 0 ? this.autos.length : at;

    this.autos.splice(index, 0, spell);
    this.lefts.splice(index, 0, 0);
    this.sets.splice(index, 0, 0);
    this.dues.splice(index, 0, 0);
    // Armed during a step, after the spell being walked: the walk reaches it, so it counts this step as before.
    this.setClock(index, seconds, dt);

    if (this.walking >= 0 && spell > this.walking) {
      this.sets[index] = this.steps - 1;
      this.dues[index] = (this.dues[index] ?? 0) - 1;
      this.nextDue = Math.min(this.nextDue, this.dues[index] ?? 0);
    }

    return true;
  }

  /** Sets an armed clock to `seconds` left from now, on steps of `dt`. */
  setClock(index: number, seconds: number, dt: number): void {
    const due = this.steps + stepsUntil(seconds, dt);

    this.lefts[index] = seconds;
    this.sets[index] = this.steps;
    this.dues[index] = due;

    if (due < this.nextDue) {
      this.nextDue = due;
    }
  }

  /** The seconds left on an armed clock: what it was set to, less the steps since, and 0 once it ran out. */
  leftAt(index: number, dt: number): number {
    if (this.steps >= (this.dues[index] ?? 0)) {
      return 0;
    }

    return (this.lefts[index] ?? 0) - (this.steps - (this.sets[index] ?? 0)) * dt;
  }

  /**
   * Sets an armed clock after its cast to the seconds it now has left. The cast may have armed or disarmed clocks (a
   * proc of the game's), so the clock is found again by its spell.
   */
  settle(spell: SpellId, left: number, dt: number): void {
    const index = this.autos.indexOf(spell);

    if (index >= 0) {
      this.setClock(index, left, dt);
    }
  }

  /** Makes `nextDue` the earliest of the armed clocks' ends again. */
  resetDue(): void {
    let next = Number.POSITIVE_INFINITY;

    for (const due of this.dues) {
      next = due < next ? due : next;
    }

    this.nextDue = next;
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
    this.lefts.splice(index, 1);
    this.sets.splice(index, 1);
    this.dues.splice(index, 1);

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

/** A hook threw: the cast stops where it is, with no more hooks, and leaves its caster's list (the caller unholds it). */
export const stopThrown = <G extends SpellTypes>(cast: Cast<G>): void => {
  if (cast.stage !== 'ended') {
    cast.stage = 'ended';
    recordOf(cast.caster).remove(cast.cast);
  }
};
