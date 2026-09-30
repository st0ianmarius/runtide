import { countDown, isRunOut } from '../core/index.ts';
import { type AutoActivation, isAuto } from './activation.ts';
import type { CastReport, Report } from './cast-request.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import { NO_CAST } from './ids.ts';
import type { SpellCaster, SpellId, SpellTypes } from './spell-types.ts';

/** What an `auto` clock costs after a cast: the whole interval, or a retry after a few seconds. */
type Cost = 'spend' | 'retry';

/** Whether a refusal is a reach rule's (§I.7.1 F16). */
const isReachRefusal = (refusal: CastReport['refusal']): boolean =>
  refusal === 'range' || refusal === 'sight' || refusal === 'placement';

/**
 * What a cast costs its clock (§II.6 S2): a refusal by the gates or `canCast` answers `onRefused` (spend by default),
 * a refusal for no target or out of reach `onNoTarget` (retry: a swing's reach polled every step, unless its `ready`
 * hook holds it), an instant cast whose release set nothing off `onMiss` (retry), and
 * any other cast spends.
 */
const costOf = <G extends SpellTypes>(activation: AutoActivation<G>, report: CastReport<G>): Cost => {
  if (report.refusal === 'target' || isReachRefusal(report.refusal)) {
    return activation.onNoTarget ?? 'retry';
  }

  if (report.refusal !== undefined) {
    return activation.onRefused ?? 'spend';
  }

  return report.hasReleased && report.status === 'ended' && report.went === 0
    ? (activation.onMiss ?? 'retry')
    : 'spend';
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
 * Steps a caster's armed `auto` clocks by one step (§II.3.2, §II.6 S2), in registry order: each counts down, and one
 * that ran out casts its spell, unless it resets after casts (`afterCast: 'reset'`) and the caster is casting: it
 * waits for the cast to end, which resets it. After the cast the clock is set, with no carry-over, to the interval
 * read at the cast (spend) or to the activation's `retry` seconds (the next step when it has none), as the outcome's
 * cost says. A clock whose activation says the caster is not `ready` waits at zero, casting nothing. A caster with
 * nothing armed costs one length check.
 */
export const stepAutoClocks = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  cast: (caster: G['bearer'], spell: SpellId) => Report<G>,
): void => {
  const record = recordOf(caster);
  const { autos, clocks } = record;
  const { dt, countdown } = engine.clock;

  for (let i = 0; i < autos.length; i++) {
    const spell = autos[i];
    const left = countDown(clocks[i] ?? 0, dt, countdown);

    clocks[i] = left;

    if (
      spell === undefined ||
      !isRunOut(left, countdown) ||
      (record.count > 0 && engine.resetsAfterCast[spell] === 1)
    ) {
      continue;
    }

    const activation = autoOf(engine, spell);

    if (activation.ready?.(caster) === false) {
      continue;
    }

    const report = cast(caster, spell);
    const next = costOf(activation, report) === 'spend' ? report.interval : (activation.retry ?? 0);

    record.settle(spell, report.interval, next);
  }
};

/** The seconds left on a caster's `auto` clock for a spell; 0 for a spell it has not armed. */
export const autoClockOf = (caster: SpellCaster, spell: SpellId): number => {
  const record = recordOf(caster);
  const index = record.autoAt(spell);

  return index < 0 ? 0 : (record.clocks[index] ?? 0);
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

/**
 * A rescale of a caster's pending clocks (§II.6 A13, §I.7.1 F15): an aura system's host hands one on an aura's edges
 * (`ClockRescale` is one), and the `rescaleClocks` proc makes one.
 */
export interface ClockScale {
  /** What the clocks' time left is multiplied by, from 0. */
  readonly factor: number;

  /** The spell tag whose clocks rescale (a spell tag id); every clock when absent or −1. */
  readonly tag?: number;

  /**
   * `pending` (the default): only the `auto` clocks still counting rescale; `all`: also the stage time left of the
   * caster's running casts (a windup, a channel, a recovery).
   */
  readonly clocks?: 'pending' | 'all';
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

/** Rescales the stage time left of a caster's running casts in scope; how many. */
const rescaleCasts = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  [factor, scope]: readonly [number, number],
): number => {
  const record = recordOf(caster);
  let rescaled = 0;

  for (let i = 0; i < record.count; i++) {
    const cast = engine.castOf(record.handles[i] ?? NO_CAST);

    if (cast !== undefined && cast.stage !== 'ended' && cast.remaining > 0 && inScope(engine, cast.spell, scope)) {
      cast.remaining *= factor;
      rescaled += 1;
    }
  }

  return rescaled;
};

/**
 * Rescales a caster's clocks (§II.6 A13): every `auto` clock still counting whose spell is in scope, times the
 * factor (haste's edges: an attack clock sped up as a haste aura lands and slowed as it goes), and with
 * `clocks: 'all'` the stage time left of its running casts in scope too. Returns how many it rescaled.
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

  const parts = [factor, rescale.tag ?? -1] as const;
  const auto = rescaleAuto(engine, caster, parts);

  return rescale.clocks === 'all' ? auto + rescaleCasts(engine, caster, parts) : auto;
};

/**
 * Resets a caster's `auto` clocks that reset after its other casts (§II.6 S3: `afterCast: 'reset'`) as one of its
 * casts ends: each is set to its constant interval, else to the interval it last read. An auto spell's own cast
 * resets none. Returns how many it reset.
 */
export const resetAfterCast = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  spell: SpellId,
): number => {
  if (!engine.hasResets || isAuto(engine.registry.get(spell).activation)) {
    return 0;
  }

  const { autos, clocks, intervals } = recordOf(caster);
  let reset = 0;

  for (let i = 0; i < autos.length; i++) {
    const armed = autos[i];

    if (armed !== undefined && engine.resetsAfterCast[armed] === 1) {
      const { interval } = autoOf(engine, armed);

      clocks[i] = typeof interval === 'number' ? interval : (intervals[i] ?? 0);
      reset += 1;
    }
  }

  return reset;
};
