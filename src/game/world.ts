import type { UnitEvent, UnitEvents } from '../units/index.ts';
import { createMemoryWorld, type MemoryWorld, type WorldQuery } from '../world/index.ts';
import type { GameBus, GameTypes, GameWorldSpec, WorldBody } from './spec.ts';

/** A game's world: what the systems query, the memory world when `createGame` built one, and how it folds. */
export interface GameWorld<G extends GameTypes> {
  /** What the systems query. */
  readonly query: WorldQuery<G['bearer']> | undefined;

  /** The memory world `createGame` built; `undefined` for the game's own. */
  readonly memory: MemoryWorld<G['bearer']> | undefined;

  /** Folds the world into a digest, if it folds. */
  readonly digest: ((hash: number) => number) | undefined;
}

/** Throws a `RangeError` naming what a game's world needs. */
const refuse = (problem: string): never => {
  throw new RangeError(`createGame, world: ${problem}.`);
};

/** The body a unit spawned at a point gets when the game says nothing: radius 0 there; none without a point. */
const pointBody = (_unit: unknown, at: WorldBody['at'] | undefined): WorldBody | undefined =>
  at === undefined ? undefined : { at };

/**
 * Keeps a memory world in step with the units: a spawned unit gets its body (`bodyOf`), a despawned one leaves, and
 * one changing sides moves to its new side. Throws unless the game gave the bus and the unit event kinds.
 */
const follow = <G extends GameTypes>(
  memory: MemoryWorld<G['bearer']>,
  bodyOf: (unit: G['bearer'], at: WorldBody['at'] | undefined) => WorldBody | undefined,
  bus: GameBus | undefined,
  events: UnitEvents<G> | undefined
): void => {
  const spawned = events?.spawned ?? refuse('a memory world follows the units, so units.events needs spawned');
  const despawned = events?.despawned ?? refuse('a memory world follows the units, so units.events needs despawned');
  const sideChanged = events?.sideChanged ?? refuse('a memory world follows sides, so units.events needs sideChanged');
  const on = bus ?? refuse('a memory world follows the units, so the game gives the bus they are heard on');

  on.on(spawned, (event: UnitEvent<G>) => {
    const unit = event.unit;
    const body = unit === undefined ? undefined : bodyOf(unit, event.at);

    if (unit !== undefined && body !== undefined) {
      memory.add(unit, { id: unit.id, at: body.at, radius: body.radius ?? 0, side: unit.side });
    }
  });

  on.on(despawned, (event: UnitEvent<G>) => {
    if (event.unit !== undefined) {
      memory.remove(event.unit);
    }
  });

  on.on(sideChanged, (event: UnitEvent<G>) => {
    if (event.unit !== undefined && memory.has(event.unit)) {
      memory.setSide(event.unit, event.unit.side);
    }
  });
};

/** Builds a game's world from its spec, a memory world kept in step with the units through the bus. */
export const worldOf = <G extends GameTypes>(
  spec: GameWorldSpec<G> | undefined,
  bus: GameBus | undefined,
  events: UnitEvents<G> | undefined
): GameWorld<G> => {
  if (spec === undefined) {
    return { query: undefined, memory: undefined, digest: undefined };
  }

  if ('query' in spec) {
    return { query: spec.query, memory: undefined, digest: spec.digest };
  }

  const memory = createMemoryWorld<G['bearer']>({ idOf: (unit) => unit.id, ...spec.memory });

  follow(memory, spec.bodyOf ?? pointBody, bus, events);

  return { query: memory, memory, digest: memory.digest };
};
