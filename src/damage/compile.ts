import type { StatId, StatTable } from '../modifiers/index.ts';
import type { DamageTypes } from './damage-types.ts';
import type { DamageKindTable } from './kinds.ts';
import { type CompiledRow, compileMitigation } from './mitigation.ts';
import type { DamageSystemOptions } from './options.ts';
import { compileStageOrder, type StageDef, type StageOrder } from './stage-order.ts';

/**
 * The damage pipeline's built-in stages, in their documented order: the ignore gates before any
 * roll, the attacker's outgoing multipliers, the roll table's outcome rows (miss, dodge, block, crit or the game's
 * own), the mitigation rows, absorbs, `onLethal` and health; then the after-stages every blow runs however it ended:
 * the attacker's `onDealt` hooks, the outcome events and cues, and the death pipeline.
 */
export const DAMAGE_STAGES = Object.freeze([
  'ignore',
  'outgoing',
  'roll',
  'mitigation',
  'absorb',
  'lethal',
  'health',
  'dealt',
  'outcome',
  'death',
] as const);

/**
 * The heal pipeline's built-in stages: the healer's healing done, the target's healing received and health; then
 * the event. A game blocks a heal with a stage of its own (a wound's).
 */
export const HEAL_STAGES = Object.freeze(['done', 'received', 'health', 'outcome'] as const);

/** The force pipeline's built-in stages: the `onIncomingForce` hooks, then the host moves the unit. */
export const FORCE_STAGES = Object.freeze(['resist', 'apply'] as const);

/** The stats and tags the built-in stages read, resolved to ids (`undefined` when not configured). */
export interface StageStats {
  /** The outgoing multiplier stats. */
  readonly outgoing: readonly StatId[];

  /** The healing received stat. */
  readonly healReceived: StatId | undefined;

  /** The healing done stat. */
  readonly healDone: StatId | undefined;
}

/** Throws a load-time error about the damage system's options. */
const refuse = (problem: string): never => {
  throw new RangeError(`Damage system: ${problem}`);
};

/** Resolves a stat name, checking its kind. */
const statIn = (stats: StatTable | undefined, name: string | undefined, isMultiplier: boolean): StatId | undefined => {
  if (name === undefined) {
    return undefined;
  }

  const id = (stats ?? refuse(`stat ${name} needs the game's stat table (stats).`)).index.idOf(name);

  if (id === undefined) {
    return refuse(`there is no stat ${name}.`);
  }

  if (stats?.index.isMultiplier(id) !== isMultiplier) {
    refuse(`${name} must be a ${isMultiplier ? 'multiplier' : 'flat'} stat.`);
  }

  return id;
};

/** Resolves every stat and tag the built-in stages read, checking each one's kind. */
export const compileStats = <G extends DamageTypes>(options: DamageSystemOptions<G>): StageStats => {
  const { stats } = options;
  const outgoing = (options.outgoing ?? []).map((name) => statIn(stats, name, true));

  return {
    outgoing: outgoing.filter((id): id is StatId => id !== undefined),
    healReceived: statIn(stats, options.heal?.received, true),
    healDone: statIn(stats, options.heal?.done, true),
  };
};

/** Checks that the host has what the configured stages need. */
export const checkHost = <G extends DamageTypes>(options: DamageSystemOptions<G>, stats: StageStats): void => {
  const { host } = options;

  const readsStats =
    stats.outgoing.length > 0 ||
    [stats.healReceived, stats.healDone].some((stat) => stat !== undefined) ||
    options.mitigation !== undefined ||
    options.rolls !== undefined;

  if (typeof host.health !== 'function' || typeof host.setHealth !== 'function') {
    refuse('the host needs health and setHealth.');
  }

  if (readsStats && host.statsOf === undefined) {
    refuse('stages that read stats need host.statsOf.');
  }

  const { rolls } = options;

  if (rolls !== undefined && host.roll === undefined && (rolls.mode === 'single' || options.rollChance === undefined)) {
    refuse('outcome rows need host.roll (or rollChance, in independent mode).');
  }
};

/** The stages each kind skips, as one flag per kind and stage position, checked against the stage order. */
export const compileBypass = (kinds: DamageKindTable, order: StageOrder<unknown>): Uint8Array => {
  const size = order.names.length;
  const flags = new Uint8Array(kinds.size * size);

  for (const kind of kinds.ids) {
    for (const stage of kinds.get(kind).bypass ?? []) {
      const at = order.names.indexOf(stage);

      if (at < 0 || at >= order.afterFrom - 1) {
        refuse(`damage kind ${kinds.name(kind)} cannot skip ${stage}: no such stage before health.`);
      }

      flags[kind * size + at] = 1;
    }
  }

  return flags;
};

/** Compiles one pipeline's stage order with the game's stages. */
export const orderOf = <Run>(
  what: string,
  parts: { readonly builtIn: readonly string[]; readonly boundary: string },
  game: Readonly<Record<string, StageDef<Run>>> | undefined,
): StageOrder<Run> => compileStageOrder({ what, builtIn: parts.builtIn, boundary: parts.boundary, game });

/** Compiles the mitigation rows, if any, checking every kind that does not skip mitigation is covered. */
export const rowsOf = <G extends DamageTypes>(
  options: DamageSystemOptions<G>,
  parts: { readonly bypass: Uint8Array; readonly order: StageOrder<unknown> },
): readonly CompiledRow[] => {
  const { mitigation, stats } = options;

  if (mitigation === undefined) {
    return [];
  }

  const at = parts.order.names.indexOf('mitigation');
  const size = parts.order.names.length;

  return compileMitigation(mitigation, {
    stats: stats ?? refuse('mitigation needs the game stat table (stats).'),
    kinds: options.kinds,
    skips: (kind) => parts.bypass[kind * size + at] === 1,
  });
};
