import type { AbilitySystem } from '../abilities/index.ts';
import type { AuraId, AuraSystem } from '../auras/index.ts';
import type { ConditionTables } from '../conditions/index.ts';
import { checkPredicted, type PredictedReport } from '../prediction/index.ts';
import type { MirrorOptions, MirrorRefusal } from './mirror-types.ts';
import type { GameTypes } from './spec.ts';

/** The checks a mirror is refused on, in the order its error lists them. */
const REFUSALS: readonly MirrorRefusal[] = ['unpredicted', 'unsafe', 'unseedable', 'inexact', 'frozen'];

/** What each check means, for the error. */
const MEANING: Readonly<Record<MirrorRefusal, string>> = {
  unpredicted: 'read by the mirror but not predicted',
  unsafe: 'predicted with a modifier condition that is not mirror-safe',
  unseedable: 'predicted with an onLand hook a seed cannot put back',
  inexact: 'predicted with an add or min modifier on a stat the motion step folds',
  frozen: 'read by the mirror on a clock it does not tick'
};

/**
 * The clocks a mirror ticks, in the aura system's declared order. Throws a `RangeError` for one named twice or none;
 * an unknown name is refused by `checkPredicted`.
 */
export const tickedClocks = <G extends GameTypes>(
  auras: Pick<AuraSystem<G>, 'clockTable'>,
  ticks: readonly G['clock'][]
): readonly G['clock'][] => {
  if (new Set(ticks).size !== ticks.length) {
    throw new RangeError(`createMirror: a mirror ticks each clock once; got ${ticks.join(', ')}.`);
  }

  return Object.freeze(auras.clockTable.names.filter((name) => ticks.includes(name)));
};

/** The aura ids of a check's findings. */
const idsOf = (report: PredictedReport, check: MirrorRefusal): readonly AuraId[] =>
  check === 'unpredicted' ? report.unpredicted.map((read) => read.aura) : report[check];

/** Throws a `RangeError` for an accepted name that is not one of the registry's auras. */
const checkAccepted = <G extends GameTypes>(auras: AuraSystem<G>, accept: MirrorOptions<G>['accept']): void => {
  const known: Readonly<Record<string, AuraId | undefined>> = auras.registry.id;

  for (const names of Object.values(accept ?? {})) {
    for (const name of names ?? []) {
      if (known[name] === undefined) {
        throw new RangeError(`createMirror: accept names ${name}, which is not an aura.`);
      }
    }
  }
};

/**
 * Runs `checkPredicted` over a mirror's systems, its motion reads and the clocks it ticks, and throws one `RangeError`
 * listing every aura found unpredicted, unsafe, unseedable, inexact or frozen that `accept` does not name for that
 * check. Returns the report.
 */
export const checkMirror = <G extends GameTypes>(
  systems: { readonly auras: AuraSystem<G>; readonly abilities: AbilitySystem<G> },
  options: MirrorOptions<G>,
  conditions: ConditionTables | undefined
): PredictedReport => {
  const { auras, abilities } = systems;

  checkAccepted(auras, options.accept);

  const report = checkPredicted<G>({
    auras,
    abilities,
    motion: { ...options.reads, clocks: options.ticks },
    ...(conditions === undefined ? {} : { conditions })
  });

  const problems: string[] = [];

  for (const check of REFUSALS) {
    const accepted = new Set<string>(options.accept?.[check] ?? []);
    const names = idsOf(report, check).map((aura) => auras.registry.name(aura));
    const refused = names.filter((name) => !accepted.has(name));

    if (refused.length > 0) {
      problems.push(`${check} (${MEANING[check]}): ${refused.join(', ')}`);
    }
  }

  if (problems.length > 0) {
    const ticked = options.ticks.join(', ');

    throw new RangeError(`createMirror, ticking ${ticked === '' ? 'no clock' : ticked}: ${problems.join('; ')}.`);
  }

  return report;
};
