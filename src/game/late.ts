import type { DamageSystemOptions } from '../damage/index.ts';
import type { RecordsCheck } from '../damage/records-check.ts';
import type { ProcRegistry, ProcTypes } from '../procs/index.ts';
import type { GameRecords, GameTypes } from './spec.ts';

/** A system built after the systems that name it: they read it through `get`, which `createGame` fills before it returns. */
export interface Late<T> {
  /** The system; throws while it is not built yet (only while `createGame` runs). */
  readonly get: () => T;

  /** Fills the cell. */
  readonly set: (value: T) => void;
}

/** An empty late cell for a system by name. */
export const late = <T>(name: string): Late<T> => {
  const cell: { value?: T } = {};

  return {
    get: () => {
      if (cell.value === undefined) {
        throw new Error(`createGame: the ${name} system was read before it was built.`);
      }

      return cell.value;
    },

    set: (value) => {
      cell.value = value;
    }
  };
};

/**
 * Throws a `RangeError` unless a proc registry holds every kind each system gave it (the game's `procs.kinds`
 * function), each as that system made it.
 */
export const checkKinds = <G extends ProcTypes>(
  registry: ProcRegistry<G>,
  systems: Readonly<Record<string, object | undefined>>
): void => {
  for (const [system, kinds] of Object.entries(systems)) {
    for (const [name, kind] of Object.entries(kinds ?? {})) {
      const id = registry.id[name];

      if (id === undefined || !Object.is(registry.defs[id], kind)) {
        throw new RangeError(`createGame, procs.kinds: the proc registry does not hold ${system}.procKinds.${name}.`);
      }
    }
  }
};

/** Whether a value is `undefined` as a game's ext: always, for a game whose ext admits it (the systems' own default). */
const isNoExt = <E>(value: E | undefined): value is undefined & E => value === undefined;

/**
 * The game's ext factory, or one making `undefined` (the systems' own default, for a game whose ext admits it), so
 * `createGame` always hands a system its `createExt`.
 */
export const extOr = <E>(create: (() => E) | undefined): (() => E) =>
  create ??
  ((): E => {
    const none = undefined;

    if (!isNoExt<E>(none)) {
      throw new TypeError('createGame: this system needs createExt.');
    }

    return none;
  });

/**
 * Whether damage options carry the damage system's records check: they do for a game whose `blow` and `force` are the
 * framework's (`GameRecords`), which `createGame`'s type asks of every game.
 */
export const isRecordsChecked = <G extends GameTypes & GameRecords<G>>(
  options: DamageSystemOptions<G>
): options is DamageSystemOptions<G> & RecordsCheck<G> => typeof options === 'object';
