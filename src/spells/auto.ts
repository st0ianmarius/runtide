import { countDown, isRunOut } from '../core/index.ts';
import { type AutoActivation, isAuto } from './activation.ts';
import type { CastReport } from './cast-request.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import { NO_CAST } from './ids.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/** What an `auto` clock costs after a cast: the whole interval, or a retry after a few seconds. */
type Cost = 'spend' | 'retry';

/** Whether a refusal is a reach rule's (§I.7.1 F16). */
const isReachRefusal = (refusal: CastReport['refusal']): boolean =>
  refusal === 'range' || refusal === 'sight' || refusal === 'placement';

/**
 * What a cast costs its clock (§II.6 S2): a refusal by the gates or `canCast` answers `onRefused` (spend by default),
 * a refusal for no target or out of reach `onNoTarget` (retry: a swing's reach polled every step), an instant cast whose release set nothing off `onMiss` (retry), and
 * any other cast spends.
 */
const costOf = <G extends SpellTypes>(activation: AutoActivation<G>, report: CastReport): Cost => {
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
 * Steps a caster's `auto` clocks by one step (§II.3.2, §II.6 S2), in registry order: every clock counts down, whether
 * its spell is owned or not (so a spell the caster gains fires at once), and one that ran out casts its spell when the
 * caster owns it (`host.owns`). After the cast the clock is set, with no carry-over, to the interval read at the cast
 * (spend) or to the activation's `retry` seconds (the next step when it has none), as the outcome's cost says.
 */
export const stepAutoClocks = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  cast: (caster: G['bearer'], spell: SpellId) => CastReport,
): void => {
  const { autoIds } = engine.registry;
  const { clocks } = recordOf(caster);
  const { dt, countdown } = engine.clock;

  for (let i = 0; i < autoIds.length; i++) {
    const spell = autoIds[i];
    const left = countDown(clocks[i] ?? 0, dt, countdown);

    clocks[i] = left;

    if (spell === undefined || !isRunOut(left, countdown) || engine.host.owns?.(caster, spell) === false) {
      continue;
    }

    const report = cast(caster, spell);
    const activation = autoOf(engine, spell);

    clocks[i] = costOf(activation, report) === 'spend' ? report.interval : (activation.retry ?? 0);
  }
};

/** The seconds left on a caster's `auto` clock for a spell; 0 for a spell that is not `auto`. */
export const autoClockOf = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  spell: SpellId,
): number => {
  const index = engine.registry.autoIds.indexOf(spell);

  return index < 0 ? 0 : (recordOf(caster).clocks[index] ?? 0);
};

/**
 * A rescale of a caster's pending clocks (§II.6 A13, §I.7.1 F15): an aura system's host hands one on an aura's edges
 * (`ClockRescale` is one), and the `rescaleClocks` proc makes one.
 */
export interface ClockScale {
  /** What the clocks' time left is multiplied by, from 0. */
  readonly factor: number;

  /** The spell tag whose clocks rescale (a spell tag id); every clock when absent or −1. */
  readonly scope?: number;

  /**
   * Whether only the `auto` clocks still counting rescale (true when absent), or also the stage time left of the
   * caster's running casts (a windup, a channel, a recovery).
   */
  readonly isPendingOnly?: boolean;
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
  const { autoIds } = engine.registry;
  const { clocks } = recordOf(caster);
  let rescaled = 0;

  for (let i = 0; i < autoIds.length; i++) {
    const spell = autoIds[i];
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
 * `isPendingOnly: false` the stage time left of its running casts in scope too. Returns how many it rescaled.
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

  const parts = [factor, rescale.scope ?? -1] as const;
  const auto = rescaleAuto(engine, caster, parts);

  return rescale.isPendingOnly === false ? auto + rescaleCasts(engine, caster, parts) : auto;
};
