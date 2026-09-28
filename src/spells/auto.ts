import { countDown, isRunOut } from '../core/index.ts';
import { type AutoActivation, isAuto } from './activation.ts';
import { recordOf } from './caster.ts';
import type { SpellEngine } from './engine.ts';
import type { CastReport } from './runner.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/** What an `auto` clock costs after a cast: the whole interval, or a retry after a few seconds. */
type Cost = 'spend' | 'retry';

/**
 * What a cast costs its clock (§II.6 S2): a refusal by the gates or `canCast` answers `onRefused` (spend by default),
 * a refusal for no target `onNoTarget` (retry), an instant cast whose release set nothing off `onMiss` (retry), and
 * any other cast spends.
 */
const costOf = <G extends SpellTypes>(activation: AutoActivation<G>, report: CastReport): Cost => {
  if (report.refusal === 'target') {
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
