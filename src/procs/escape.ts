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
 * Every escape hatch a game registered, counted so the escapes stay visible and few: a game prints it in CI,
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

  /** The game's own activation kinds, and core kinds it replaced, in registry order (hatch 2). */
  readonly activationKinds: readonly string[];

  /** The game's own world-query extensions (`WorldQuery & GameQuery`), in declaration order (hatch 5). */
  readonly queryExtensions: readonly string[];
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

/**
 * What the escape report reads from a spell system (a `SpellSystem` is one): its proc kinds, which are the framework's
 * own and not hatches, and the game's own activation kinds.
 */
export interface EscapeSpells {
  /** The spell system's proc kinds, by name. */
  readonly procKinds: object;

  /** The game's own activation kinds. */
  readonly gameActivations: readonly string[];
}

/**
 * What the escape report reads from any other system with proc kinds (area triggers, abilities, units, AI): its proc
 * kinds, which are the framework's own and not hatches.
 */
export interface EscapeKinds {
  /** The system's proc kinds, by name. */
  readonly procKinds: object;
}

/** What the escape report reads from a world (a `WorldQuery` is one): the names of the game's query extensions. */
export interface EscapeWorld {
  /** The game's own query extensions. */
  readonly extensions: readonly string[];
}

/** The framework's kinds, by name. */
const CORE: Readonly<Record<string, object | undefined>> = CORE_PROCS;

/** Whether a system's own kind of that name is this very definition. */
const isOwn = (kinds: object | undefined, name: string, def: object): boolean =>
  Object.entries(kinds ?? {}).some(([own, kind]) => own === name && kind === def);

/**
 * Whether a kind's definition is the framework's own kind of that name: a core kind, or one of the proc kinds of a
 * system (`systems`, each system's kinds by name).
 */
const isCore = (name: string, def: object | undefined, systems: readonly (object | undefined)[]): boolean =>
  def !== undefined && (CORE[name] === def || systems.some((kinds) => isOwn(kinds, name, def)));

/** The escape report of a game's registries. */
export const escapeReport = <G extends ProcTypes>(registries: {
  /** The game's proc system. */
  readonly procs: ProcSystem<G>;

  /** The game's damage system, if it has one. */
  readonly damage?: EscapeDamage;

  /** The game's spell system, if it has one. */
  readonly spells?: EscapeSpells;

  /** The game's area trigger system, if it has one. */
  readonly areaTriggers?: EscapeKinds;

  /** The game's ability system, if it has one. */
  readonly abilities?: EscapeKinds;

  /** The game's unit system, if it has one. */
  readonly units?: EscapeKinds;

  /** The game's AI system, if it has one. */
  readonly ai?: EscapeKinds;

  /** The game's world, if it asks one. */
  readonly world?: EscapeWorld;
}): EscapeReport => {
  const { kinds, runs } = registries.procs;
  const { damage, spells } = registries;

  const { areaTriggers, abilities, units, ai } = registries;
  const systems = [damage, spells, areaTriggers, abilities, units, ai].map((system) => system?.procKinds);

  return {
    procKinds: kinds.names.filter((name, index) => !isCore(name, kinds.defs[index], systems)),
    runs: [...runs].map(([hatch, count]) => ({ hatch, count })),
    stages: damage?.gameStages ?? [],
    activationKinds: spells?.gameActivations ?? [],
    queryExtensions: registries.world?.extensions ?? [],
  };
};
