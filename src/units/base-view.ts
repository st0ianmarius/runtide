import type { StatId, StatView } from '../modifiers/index.ts';

/** A stat view of a unit's own snapshotted bases, for a game without a modifier system. */
export class BaseView implements StatView {
  readonly #base: ArrayLike<number>;

  constructor(base: ArrayLike<number>) {
    this.#base = base;
  }

  total(stat: StatId): number {
    return this.#base[stat] ?? 0;
  }

  base(stat: StatId): number {
    return this.#base[stat] ?? 0;
  }
}
