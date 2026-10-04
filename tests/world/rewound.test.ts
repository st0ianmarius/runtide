import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { circle, vec2 } from '../../src/math/index.ts';
import { createMemoryWorld, rewoundQuery, Trail } from '../../src/world/index.ts';

/** A test unit: a name, and the trail of where it was sent. */
interface Mob {
  /** Its name. */
  readonly name: string;

  /** Its trail; none for a unit that is never rewound. */
  readonly trail: Trail | undefined;
}

const BOUNDS = { minX: -50, minZ: -50, maxX: 50, maxZ: 50 };

/**
 * A world where `runner` (id 1) was sent at (0, 0) on tick 0, (10, 0) on tick 2 and (20, 0) on tick 4, where it stands
 * now; `still` (id 2, no trail) stands at (8, 0), the caster (id 3) at (-10, 0) and an ally of it (id 4) at (5, 0).
 */
const scene = () => {
  const world = createMemoryWorld<Mob>({ bounds: BOUNDS, cell: 4 });

  const mob = (name: string, id: number, at: readonly [number, number], side: number, trail?: Trail): Mob => {
    const made = { name, trail };

    world.add(made, { id, at: vec2(at[0], at[1]), side });

    return made;
  };

  const trail = new Trail(8);

  trail.record(0, vec2(0, 0));
  trail.record(2, vec2(10, 0));
  trail.record(4, vec2(20, 0));

  const runner = mob('runner', 1, [20, 0], 1, trail);
  const still = mob('still', 2, [8, 0], 1);
  const caster = mob('caster', 3, [-10, 0], 0);
  const ally = mob('ally', 4, [5, 0], 0);
  const rewind = { trailOf: (unit: Mob) => unit.trail, tick: 1, slack: 25 };
  const view = rewoundQuery(world, rewind);
  const out: (Mob | undefined)[] = [];
  const names = (count: number): string[] => out.slice(0, count).map((unit) => unit?.name ?? '?');

  return { world, view, rewind, runner, still, caster, ally, out, names };
};

describe('a rewound world query', () => {
  it('reads a unit on its trail at the rewound tick, between irregular sends, and one with none where it stands', () => {
    const { view, rewind, runner, still } = scene();
    const out = { x: 0, z: 0 };

    assert.deepEqual({ ...view.positionOf(runner, out) }, { x: 5, z: 0 });
    rewind.tick = 3.5;
    assert.deepEqual({ ...view.positionOf(runner, out) }, { x: 17.5, z: 0 });
    assert.deepEqual({ ...view.positionOf(still, out) }, { x: 8, z: 0 });
  });

  it('hits a unit that moved since the tick at where it stood then, and misses it where it stands now', () => {
    const { world, view, caster, out, names } = scene();
    const options = { side: 'foes', of: caster } as const;

    assert.deepEqual(names(view.inside(circle(1, vec2(5, 0)), options, out)), ['runner']);
    assert.deepEqual(names(world.inside(circle(1, vec2(5, 0)), options, out)), []);
    assert.deepEqual(names(view.inside(circle(1, vec2(20, 0)), options, out)), []);
    assert.deepEqual(names(world.inside(circle(1, vec2(20, 0)), options, out)), ['runner']);
    assert.equal(view.count(circle(4, vec2(6, 0)), options), 2);
    assert.equal(view.count(circle(4, vec2(6, 0)), {}), 3, 'the ally counts with no side');
  });

  it('orders and caps nearest by the rewound positions', () => {
    const { view, caster, out, names } = scene();

    assert.deepEqual(names(view.nearest(vec2(7, 0), { range: 3, side: 'foes', of: caster }, out)), ['still', 'runner']);
    assert.deepEqual(names(view.nearest(vec2(4, 0), { range: 3, side: 'foes', of: caster }, out)), ['runner']);
    assert.deepEqual(names(view.nearest(vec2(7, 0), { range: 2, of: caster, limit: 1 }, out)), ['still']);
    assert.deepEqual(names(view.all({ side: 'foes', of: caster, order: 'far', from: vec2(0, 0) }, out)), [
      'still',
      'runner'
    ]);
    // The runner and the ally both stood at (5, 0): the tie falls to the lower id.
    assert.deepEqual(names(view.all({ order: 'near', from: vec2(4, 0), exclude: new Set() }, out)), [
      'runner',
      'ally',
      'still',
      'caster'
    ]);
  });

  it('sweeps against the rewound positions, its contacts in order, and relative to the rewound motion', () => {
    const { view, rewind, caster, out, names } = scene();
    const shares: number[] = [];

    assert.deepEqual(
      names(view.sweep(vec2(0, 0), vec2(10, 0), { radius: 0.5, side: 'foes', of: caster, shares }, out)),
      ['runner', 'still']
    );
    assert.deepEqual(shares.slice(0, 2), [0.45, 0.75]);

    // Between ticks 1 and 2 the runner went from (5, 0) to (10, 0): a missile crossing x = 7.4 meets it about halfway.
    rewind.tick = 2;

    const across = { radius: 0.5, side: 'foes', of: caster, relative: true } as const;

    assert.deepEqual(names(view.sweep(vec2(7.4, -5), vec2(7.4, 5), across, out)), ['runner']);
    assert.deepEqual(names(view.sweep(vec2(7.4, -5), vec2(7.4, 5), { ...across, relative: false }, out)), []);
  });

  it('misses a unit that moved past the slack, and lets a filter search the view again', () => {
    const { view, rewind, caster, out, names } = scene();

    rewind.slack = 1;
    assert.deepEqual(names(view.inside(circle(1, vec2(5, 0)), { side: 'foes', of: caster }, out)), []);
    rewind.slack = 25;

    const inner: (Mob | undefined)[] = [];
    const filter = (unit: Mob): boolean => view.inside(circle(1, vec2(5, 0)), {}, inner) > 1 && unit.name !== 'ally';

    assert.deepEqual(names(view.inside(circle(1, vec2(5, 0)), { filter }, out)), ['runner']);
    assert.throws(() => view.all({ limit: -1 }, out), /limit/);
    rewind.slack = -1;
    assert.throws(() => view.all({}, out), /slack/);
  });
});
