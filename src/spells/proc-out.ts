import type { Proc } from '../procs/index.ts';
import type { SpellTypes } from './spell-types.ts';

/**
 * The reusable list a spell hook is handed to push its procs into: pushing fills it by index, so a hook that
 * returns it after pushing allocates nothing. A hook may return a plain array instead, for authoring convenience.
 */
export interface ProcOut<G extends SpellTypes> {
  /** Adds a proc last and returns the list, so pushes chain and the hook can return the result. */
  readonly push: (proc: Proc<G>) => ProcOut<G>;

  /** How many procs were pushed since the list was handed over. */
  readonly count: number;
}

/**
 * The list behind `ProcOut`: its procs up to `count`, and `undefined` past it, so the proc runner (which skips an
 * `undefined` entry) runs exactly what was pushed. Never shrunk, since shrinking an array drops its storage.
 */
export class ProcList<G extends SpellTypes> implements ProcOut<G> {
  /** The procs, valid up to `count`; every entry past it is `undefined`. */
  readonly items: (Proc<G> | undefined)[] = [];

  /** How many procs were pushed. */
  count = 0;

  readonly push = (proc: Proc<G>): ProcOut<G> => {
    this.items[this.count] = proc;
    this.count += 1;

    return this;
  };

  /** Forgets every proc pushed, clearing them to `undefined`. */
  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.items[i] = undefined;
    }

    this.count = 0;
  }
}
