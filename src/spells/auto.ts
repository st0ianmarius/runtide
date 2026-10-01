import { toId } from '../core/ids.ts';
import { type AutoActivation, isAuto } from './activation.ts';
import type { CastReport, Report } from './cast-request.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import type { SpellCaster, SpellId, SpellTypes } from './spell-types.ts';

/** The reach rules' refusals: where the target stands, which the next step may change. */
const REACH_REFUSALS: ReadonlySet<unknown> = new Set(['range', 'close', 'sight', 'reach']);

/** Whether a refusal is one of the reach rules'. */
const isReachRefusal = (refusal: unknown): boolean => REACH_REFUSALS.has(refusal);

/**
 * The default `next` of an `auto` clock: 0 (the next step) after a refusal for no target or by a reach rule
 * (a swing's reach polled every step, unless its `ready` hook holds it); the interval after anything else. A game's own
 * `next` (a swing that never went out retried, `report.went === 0`) falls back to it for the cases it leaves alone.
 */
export const autoNext = (report: CastReport, interval: number): number => {
  const { refusal } = report;

  return refusal === 'target' || isReachRefusal(refusal) ? 0 : interval;
};

/** The seconds until an `auto` clock tries again after a cast: its activation's `next`, else `autoNext`, checked. */
const nextOf = <G extends SpellTypes>(engine: SpellEngine<G>, caster: G['bearer'], report: Report<G>): number => {
  // The clock being walked: its spell, and its activation (a lookup, not a tuple built per cast).
  const spell = toId<'spells'>(recordOf(caster).walking);
  const activation = autoOf(engine, spell);
  const next = activation.next?.(report, report.interval, caster) ?? autoNext(report, report.interval);

  if (!(next >= 0) || !Number.isFinite(next)) {
    throw new RangeError(`Spell ${engine.registry.name(spell)}: an auto clock's next is finite seconds from 0.`);
  }

  return next;
};

/** An `auto` spell's activation, typed. */
const autoOf = <G extends SpellTypes>(engine: SpellEngine<G>, spell: SpellId): AutoActivation<G> => {
  const { activation } = engine.defOf(spell);

  if (!isAuto(activation)) {
    throw new TypeError(`Spell ${engine.registry.name(spell)} is not an auto spell.`);
  }

  return activation;
};

/**
 * Whether one armed clock (its index in `autos`) ran out by the caster's step count; the spell's activation when it
 * did and the caster is `ready`, so the spell casts, else `undefined`.
 */
const countClock = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  index: number
): AutoActivation<G> | undefined => {
  const record = recordOf(caster);

  if (record.steps < (record.dues[index] ?? 0)) {
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
 * one armed during it after the spell that cast is stepped too, as it would have been armed before. The clocks
 * count the caster's own steps, stamped with the step each runs out on, so a caster none of whose clocks is due costs
 * an increment and a compare.
 */
export const stepAutoClocks = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  cast: (caster: G['bearer'], spell: SpellId) => Report<G>
): void => {
  const record = recordOf(caster);

  record.steps += 1;

  if (record.steps < record.nextDue) {
    return;
  }

  const { dt } = engine.clock;
  let index = 0;
  let spell = record.autos[0];

  while (spell !== undefined) {
    record.walking = spell;

    const activation = countClock(engine, caster, index);

    if (activation !== undefined) {
      const report = cast(caster, spell);

      record.settle(spell, nextOf(engine, caster, report), dt);
    }

    index = record.after(spell);
    spell = record.autos[index];
  }

  record.walking = -1;
  record.resetDue();
};

/** The seconds left on a caster's `auto` clock for a spell; 0 for a spell it has not armed. */
export const autoClockOf = (caster: SpellCaster, [spell, dt]: readonly [SpellId, number]): number => {
  const record = recordOf(caster);
  const index = record.autoAt(spell);

  return index < 0 ? 0 : record.leftAt(index, dt);
};

/**
 * Sets the seconds left on a caster's armed `auto` clock for a spell (a creature's swing reset as its other cast
 * ends); false for a spell it has not armed. Throws for seconds that are not finite from 0.
 */
export const setAutoClock = (
  caster: SpellCaster,
  [spell, seconds, dt]: readonly [SpellId, number, number]
): boolean => {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) {
    throw new RangeError(`An auto clock is set to finite seconds from 0; got ${seconds}.`);
  }

  const record = recordOf(caster);
  const index = record.autoAt(spell);

  if (index < 0) {
    return false;
  }

  record.setClock(index, seconds, dt);
  record.resetDue();

  return true;
};

/**
 * Arms a caster's `auto` clock for a spell with `seconds` left (0 by default: it casts on the caster's next step, as a
 * spell gained mid-fight fires at once); false when it was armed already. Throws for a spell that is not `auto`.
 */
export const armAuto = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  at: { readonly spell: SpellId; readonly seconds: number }
): boolean => {
  autoOf(engine, at.spell);

  if (!(at.seconds >= 0) || !Number.isFinite(at.seconds)) {
    throw new RangeError(`An auto clock is armed with finite seconds from 0; got ${at.seconds}.`);
  }

  return recordOf(caster).arm(at.spell, at.seconds, engine.clock.dt);
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
  [factor, scope]: readonly [number, number]
): number => {
  const record = recordOf(caster);
  const { autos } = record;
  const { dt } = engine.clock;
  let rescaled = 0;

  for (let i = 0; i < autos.length; i++) {
    const spell = autos[i];
    const left = record.leftAt(i, dt);

    if (spell !== undefined && left > 0 && inScope(engine, spell, scope)) {
      record.setClock(i, left * factor, dt);
      rescaled += 1;
    }
  }

  record.resetDue();

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
  rescale: ClockScale
): number => {
  const { factor } = rescale;

  if (!(factor >= 0) || !Number.isFinite(factor)) {
    throw new RangeError(`A clock rescale takes a finite factor from 0; got ${factor}.`);
  }

  return rescaleAuto(engine, caster, [factor, rescale.tag ?? -1]);
};
