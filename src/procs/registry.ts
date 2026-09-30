import { createRegistry, type Id } from '../core/index.ts';
import type { Proc } from './proc-data.ts';
import type { ProcKindDef, ProcKinds } from './proc-kind.ts';
import type { ProcShape, ProcTypes } from './proc-types.ts';

/** The id of a proc kind: its position in the proc registry, what the runner dispatches on. */
export type ProcKindId = Id<'procs'>;

/**
 * The game's proc registry (`createProcRegistry`): each kind's dense id by key order, its definition in a table
 * indexed by that id, and which kinds act on a unit.
 */
export interface ProcRegistry<G extends ProcTypes> {
  /** The id of every kind, by name. */
  readonly id: Readonly<Record<string, ProcKindId>>;

  /** The kinds' names, in id order: developer identifiers. */
  readonly names: readonly string[];

  /** The kind definitions, in id order: `defs[id].apply(…)` is the dispatch. */
  readonly defs: readonly ProcKindDef<Proc<G>, G>[];

  /** 1 for each kind that acts on a unit (it has `targetOf`), by id. */
  readonly isTargeted: Uint8Array;

  /** The id of a proc's kind: one keyed read; throws for a kind the registry does not have. */
  readonly kindOf: (proc: ProcShape) => ProcKindId;
}

/** Whether a kind definition acts on a unit. */
const hasTarget = <G extends ProcTypes>(def: ProcKindDef<Proc<G>, G>): boolean => Object.hasOwn(def, 'targetOf');

/**
 * Registers the proc kinds: `createProcRegistry({ ...CORE_PROCS, ...GAME_PROCS })` gives each
 * kind its id by key order, freezes the definitions, and builds the dispatch table. A game adds kinds by listing them,
 * and may replace a core kind with its own (the escape report lists both).
 */
export const createProcRegistry = <G extends ProcTypes>(kinds: ProcKinds<G>): ProcRegistry<G> => {
  const table: Readonly<Record<string, ProcKindDef<Proc<G>, G>>> = kinds;
  const base = createRegistry(table, { kind: 'procs' });
  const defs = base.ids.map((id) => base.get(id));

  for (const [index, def] of defs.entries()) {
    if (typeof def.apply !== 'function') {
      throw new TypeError(`Proc kind ${base.names[index] ?? index} needs an apply function.`);
    }
  }

  const ids: Readonly<Record<string, ProcKindId>> = base.id;

  return Object.freeze({
    id: ids,
    names: base.names,
    defs: Object.freeze(defs),
    isTargeted: Uint8Array.from(defs, (def) => (hasTarget(def) ? 1 : 0)),

    kindOf: (proc: ProcShape): ProcKindId => {
      const id = ids[proc.kind];

      if (id === undefined) {
        throw new RangeError(`Unknown proc kind ${proc.kind}.`);
      }

      return id;
    },
  });
};
