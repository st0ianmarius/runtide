import type { EventKind } from '../core/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { ProcBus } from '../procs/index.ts';
import type { Lifecycle, UnitTypes } from './unit-types.ts';

/** A unit lifecycle event: a unit spawned, despawned, or moved from one lifecycle state to another. Reused. */
export interface UnitEvent<G extends UnitTypes> {
  /** The unit. */
  unit: G['bearer'] | undefined;

  /** The state it left (`alive` for a spawn). */
  from: Lifecycle;

  /** The state it entered. */
  to: Lifecycle;

  /** Where a spawn asked it to stand (a summon's point); `undefined` for a spawn with none, and for other events. */
  at: Vec2 | undefined;

  /** Why it despawned (`despawn` by default, `owner` when its owner took it along); empty for other events. */
  reason: string;
}

/** Makes an empty unit event payload: the factory a game registers the unit event kinds on its bus with. */
export const createUnitEvent = <G extends UnitTypes>(): UnitEvent<G> => ({
  unit: undefined,
  from: 'alive',
  to: 'alive',
  at: undefined,
  reason: '',
});

/** The bus and event kinds the unit system raises, each optional and raised only when something hears it. */
export interface UnitEvents<G extends UnitTypes> {
  /** The bus. */
  readonly bus: ProcBus;

  /** A unit spawned. */
  readonly spawned?: EventKind<UnitEvent<G>>;

  /** A unit moved between lifecycle states (died, revived). */
  readonly changed?: EventKind<UnitEvent<G>>;

  /** A unit despawned: removed without dying. */
  readonly despawned?: EventKind<UnitEvent<G>>;
}
