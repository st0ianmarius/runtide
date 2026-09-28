import { CORE_PROCS } from './core-procs.ts';
import type { ProcTypes } from './proc-types.ts';
import type { ProcSystem } from './system.ts';

/** One `run` hatch in the escape report: its developer name and how many times it ran. */
export interface EscapeRun {
  /** The hatch's developer name (`coil.detect`). */
  readonly hatch: string;

  /** How many times it ran so far (0 for one only seen at load). */
  readonly count: number;
}

/**
 * Every escape hatch a game registered (§I.5.6), counted so the escapes stay visible and few: a game prints it in CI,
 * and a hatch several mechanics share is a candidate for a framework feature. Later systems add their hatches (the
 * damage pipeline's stages, the world query's extensions, the game-owned tick slots).
 */
export interface EscapeReport {
  /** The game's own proc kinds, and core kinds it replaced, in registry order (hatch 1). */
  readonly procKinds: readonly string[];

  /** Every `run` hatch prepared at load or run so far, in the order first seen (hatch 3). */
  readonly runs: readonly EscapeRun[];

  /** The game's own pipeline stages (`damage.name`, `heal.name`, `force.name`), in declaration order (hatch 5). */
  readonly stages: readonly string[];
}

/**
 * What the escape report reads from a damage system (a `DamageSystem` is one): its proc kinds, which are the
 * framework's own and not hatches, and the game's own stages.
 */
export interface EscapeDamage {
  /** The damage system's proc kinds, by name. */
  readonly procKinds: object;

  /** The game's own stages. */
  readonly gameStages: readonly string[];
}

/** The framework's kinds, by name. */
const CORE: Readonly<Record<string, object | undefined>> = CORE_PROCS;

/** Whether a kind's definition is the framework's own kind of that name (a core kind, or a damage system's). */
const isCore = (name: string, def: object | undefined, damage: EscapeDamage | undefined): boolean =>
  def !== undefined &&
  (CORE[name] === def || Object.entries(damage?.procKinds ?? {}).some(([own, kind]) => own === name && kind === def));

/** The escape report of a game's registries (§I.5.6). */
export const escapeReport = <G extends ProcTypes>(registries: {
  /** The game's proc system. */
  readonly procs: ProcSystem<G>;

  /** The game's damage system, if it has one. */
  readonly damage?: EscapeDamage;
}): EscapeReport => {
  const { kinds, runs } = registries.procs;
  const { damage } = registries;

  return {
    procKinds: kinds.names.filter((name, index) => !isCore(name, kinds.defs[index], damage)),
    runs: [...runs].map(([hatch, count]) => ({ hatch, count })),
    stages: damage?.gameStages ?? [],
  };
};
