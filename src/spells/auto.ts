import { countDown, isRunOut } from '../core/index.ts';
import { type AutoActivation, isAuto } from './activation.ts';
import type { CastReport, Report } from './cast-request.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import type { SpellCaster, SpellId, SpellTypes } from './spell-types.ts';

/**
 * The default `next` of an `auto` clock: 0 (the next step) after a refusal for no target or out of reach (a
 * swing's reach polled every step, unless its `ready` hook holds it); the interval after anything else. A game's own
 * `next` (a swing that never went out retried, `report.went === 0`) falls back to it for the cases it leaves alone.
 */
export const autoNext = (report: CastReport, interval: number): number => {
  const { refusal } = report;

  return refusal === 'target' || refusal === 'range' || refusal === 'sight' ? 0 : interval;
};

/** The seconds until an `auto` clock tries again after a cast: its activation's `next`, else `autoNext`, checked. */
const nextOf = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  [spell, activation, report]: readonly [SpellId, AutoActivation<G>, Report<G>],
): number => {
  const next = activation.next?.(report, report.interval, caster) ?? autoNext(report, report.interval);

  if (!(next >= 0) || !Number.isFinite(next)) {
    throw new RangeError(`Spell ${engine.registry.name(spell)}: an auto clock's next is finite seconds from 0.`);
  }

  return next;
};

/** An `auto` spell's activation, typed. */
const autoOf = <G extends SpellTypes>(engine: SpellEngine<G>, spell: SpellId): AutoActivation<G> => {
  const { activation } = engine.registry.get(spell);

  if (!isAuto(activation)) {
    throw new TypeError(`Spell ${engine.registry.name(spell)} is not an auto spell.`);
  }

  return activation;
};

/**
 * Counts one armed clock down (its index in `autos`); the spell's activation when the clock ran out and the caster is
 * `ready`, so the spell casts, else `undefined`.
 */
const countClock = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  index: number,
): AutoActivation<G> | undefined => {
  const record = recordOf(caster);
  const left = countDown(record.clocks[index] ?? 0, engine.clock.dt);

  record.clocks[index] = left;

  if (!isRunOut(left)) {
    return undefined;
  }

  const spell = record.autos[index];
  const activation = spell === undefined ? undefined : autoOf(engine, spell);

  return activation === undefined || activation.ready?.(caster) === false ? undefined : activation;
};

/**
 * Steps a caster's armed `auto` clocks by one step, in registry order: each counts down, and one that ran out casts
 * its spell. After the cast the clock is set, with no carry-over, to what its activation's `next` answers (`autoNext`
 * by default: the interval read at the cast, or the next step). A clock whose activation says the caster is not
 * `ready` waits at zero, casting nothing. The walk goes by spell, not by index, since a cast may arm or disarm clocks:
 * one armed during it after the spell that cast is stepped too, as it would have been armed before. A caster with
 * nothing armed costs one length check.
 */
export const stepAutoClocks = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  cast: (caster: G['bearer'], spell: SpellId) => Report<G>,
): void => {
  const record = recordOf(caster);
  let index = 0;
  let spell = record.autos[0];

  while (spell !== undefined) {
    const activation = countClock(engine, caster, index);

    if (activation !== undefined) {
      const report = cast(caster, spell);

      record.settle(spell, nextOf(engine, caster, [spell, activation, report]));
    }

    index = record.after(spell);
    spell = record.autos[index];
  }
};

/** The seconds left on a caster's `auto` clock for a spell; 0 for a spell it has not armed. */
export const autoClockOf = (caster: SpellCaster, spell: SpellId): number => {
  const record = recordOf(caster);
  const index = record.autoAt(spell);

  return index < 0 ? 0 : (record.clocks[index] ?? 0);
};

/**
 * Sets the seconds left on a caster's armed `auto` clock for a spell (a creature's swing reset as its other cast
 * ends); false for a spell it has not armed. Throws for seconds that are not finite from 0.
 */
export const setAutoClock = (caster: SpellCaster, [spell, seconds]: readonly [SpellId, number]): boolean => {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) {
    throw new RangeError(`An auto clock is set to finite seconds from 0; got ${seconds}.`);
  }

  const record = recordOf(caster);
  const index = record.autoAt(spell);

  if (index < 0) {
    return false;
  }

  record.clocks[index] = seconds;

  return true;
};

/**
 * Arms a caster's `auto` clock for a spell with `seconds` left (0 by default: it casts on the caster's next step, as a
 * spell gained mid-fight fires at once); false when it was armed already. Throws for a spell that is not `auto`.
 */
export const armAuto = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  at: { readonly spell: SpellId; readonly seconds: number },
): boolean => {
  autoOf(engine, at.spell);

  if (!(at.seconds >= 0) || !Number.isFinite(at.seconds)) {
    throw new RangeError(`An auto clock is armed with finite seconds from 0; got ${at.seconds}.`);
  }

  return recordOf(caster).arm(at.spell, at.seconds);
};

/** A rescale of a caster's pending clocks: what `spells.rescaleClocks` takes and the `rescaleClocks` proc makes. */
export interface ClockScale {
  /** What the clocks' time left is multiplied by, from 0. */
  readonly factor: number;

  /** The spell tag whose clocks rescale (a spell tag id); every clock when absent or −1. */
  readonly tag?: number;
}

/** Whether a spell is in a rescale's scope. */
const inScope = <G extends SpellTypes>(engine: SpellEngine<G>, spell: SpellId, scope: number): boolean =>
  scope < 0 || engine.registry.tagSets[spell]?.has(scope) === true;

/** Rescales a caster's `auto` clocks still counting whose spells are in scope; how many. */
const rescaleAuto = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  [factor, scope]: readonly [number, number],
): number => {
  const { autos, clocks } = recordOf(caster);
  let rescaled = 0;

  for (let i = 0; i < autos.length; i++) {
    const spell = autos[i];
    const left = clocks[i] ?? 0;

    if (spell !== undefined && left > 0 && inScope(engine, spell, scope)) {
      clocks[i] = left * factor;
      rescaled += 1;
    }
  }

  return rescaled;
};

/**
 * Rescales a caster's clocks: every `auto` clock still counting whose spell is in scope, times the
 * factor (haste's edges: an attack clock sped up as a haste aura lands and slowed as it goes, from the aura's own
 * hooks). Returns how many it rescaled.
 */
export const rescaleClocks = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  rescale: ClockScale,
): number => {
  const { factor } = rescale;

  if (!(factor >= 0) || !Number.isFinite(factor)) {
    throw new RangeError(`A clock rescale takes a finite factor from 0; got ${factor}.`);
  }

  return rescaleAuto(engine, caster, [factor, rescale.tag ?? -1]);
};
