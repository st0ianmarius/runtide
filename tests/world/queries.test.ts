import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { circle, lane, ring, vec2 } from '../../src/math/index.ts';
import { type Cluster, createMemoryWorld, type MemoryWorld } from '../../src/world/index.ts';

/** A test unit: a name to read results by. */
interface Mob {
  /** Its name. */
  readonly name: string;
}

const BOUNDS = { minX: -50, minZ: -50, maxX: 50, maxZ: 50 };

/** A world with units named by id, placed as given: `[id, x, z, side?, radius?]`. */
const worldOf = (spots: readonly (readonly number[])[], index: 'grid' | 'kd' = 'grid') => {
  const world = createMemoryWorld<Mob>({ bounds: BOUNDS, index, cell: 4 });
  const mobs = new Map<number, Mob>();

  for (const [id = 0, x = 0, z = 0, side = 0, radius = 0] of spots) {
    const mob = { name: `m${id}` };

    mobs.set(id, mob);
    world.add(mob, { id, at: vec2(x, z), side, radius });
  }

  const mob = (id: number): Mob => mobs.get(id) ?? assert.fail(`no mob ${id}`);

  return { world, mob };
};

/** The names of the first `count` results. */
const names = (out: readonly (Mob | undefined)[], count: number): string[] =>
  out.slice(0, count).map((mob) => mob?.name ?? '?');

describe('inside: the units a shape covers', () => {
  it('keeps the units whose centre the shape covers, in id order by default', () => {
    const { world } = worldOf([
      [3, 1, 0],
      [1, 0, 1],
      [2, 5, 0],
      [4, -1, -1],
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(2), {}, out)), ['m1', 'm3', 'm4']);
  });

  it('reaches bodies by their radius when measured to the edge', () => {
    const { world } = worldOf([
      [1, 3, 0, 0, 0.5],
      [2, 3, 0.1, 0, 1.5],
    ]);

    const out: (Mob | undefined)[] = [];

    assert.equal(world.inside(circle(2), {}, out), 0);
    assert.deepEqual(names(out, world.inside(circle(2), { measure: 'edge' }, out)), ['m2']);
  });

  it('keeps foes or allies relative to the unit asking, and refuses a side without one', () => {
    const { world, mob } = worldOf([
      [1, 0, 0, 0],
      [2, 1, 0, 1],
      [3, 0, 1, 0],
      [4, 1, 1, 1],
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(5), { side: 'foes', of: mob(1) }, out)), ['m2', 'm4']);
    assert.deepEqual(names(out, world.inside(circle(5), { side: 'allies', of: mob(1) }, out)), ['m1', 'm3']);
    assert.throws(() => world.inside(circle(5), { side: 'foes' }, out), RangeError);
  });

  it("sorts foes by the game's rule when it has one: side 2 is everyone's foe, and its own", () => {
    const world = createMemoryWorld<Mob>({ bounds: BOUNDS, isFoe: (a, b) => a !== b || a === 2 });
    const [hero, mob, hazard, other] = [{ name: 'h' }, { name: 'm' }, { name: 'z' }, { name: 'o' }];

    world.add(hero, { id: 1, at: vec2(0, 0), side: 0 });
    world.add(mob, { id: 2, at: vec2(1, 0), side: 1 });
    world.add(hazard, { id: 3, at: vec2(0, 1), side: 2 });
    world.add(other, { id: 4, at: vec2(1, 1), side: 2 });

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(5), { side: 'foes', of: hero }, out)), ['m', 'z', 'o']);
    assert.deepEqual(names(out, world.inside(circle(5), { side: 'foes', of: hazard }, out)), ['h', 'm', 'z', 'o']);
    assert.deepEqual(names(out, world.inside(circle(5), { side: 'allies', of: hazard }, out)), []);
    assert.deepEqual(
      [world.isFoe(hero, mob), world.isFoe(hero, hero), world.isFoe(other, hazard)],
      [true, false, true],
    );
  });

  it('leaves out an exclude set and what fails the filter', () => {
    const { world, mob } = worldOf([
      [1, 0, 0],
      [2, 1, 0],
      [3, 2, 0],
    ]);

    const out: (Mob | undefined)[] = [];
    const options = { exclude: new Set([mob(1)]), filter: (unit: Mob) => unit.name !== 'm3' };

    assert.deepEqual(names(out, world.inside(circle(5), options, out)), ['m2']);
  });

  it('orders near, far, by a score, or by several keys in turn, lower id on ties', () => {
    const { world } = worldOf([
      [4, 3, 0],
      [2, 1, 0],
      [3, -1, 0],
      [1, 2, 0],
    ]);

    const out: (Mob | undefined)[] = [];
    const from = vec2(0, 0);
    const score = (unit: Mob): number => (unit.name === 'm4' ? 0 : 1);

    assert.deepEqual(names(out, world.inside(circle(9), { from, order: 'near' }, out)), ['m2', 'm3', 'm1', 'm4']);
    assert.deepEqual(names(out, world.inside(circle(9), { from, order: 'far' }, out)), ['m4', 'm1', 'm2', 'm3']);
    assert.deepEqual(names(out, world.inside(circle(9), { from, order: [score, 'far'] }, out)), [
      'm4',
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('caps the results at the limit, in order', () => {
    const { world } = worldOf([
      [1, 0, 0],
      [2, 1, 0],
      [3, 2, 0],
      [4, 3, 0],
      [5, 4, 0],
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(9), { limit: 2 }, out)), ['m1', 'm2']);
    assert.equal(world.count(circle(9), { limit: 4 }), 4);
  });

  it('filters the whole world with no shape', () => {
    const { world } = worldOf([
      [2, 40, 40],
      [1, -40, -40],
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.all({}, out)), ['m1', 'm2']);
    assert.equal(world.count(undefined, {}), 2);
    assert.equal(world.count(ring(1, 2), {}), 0);
  });
});

describe('nearest and densest', () => {
  it('finds the nearest within a range, the rim counting only when inclusive', () => {
    const { world } = worldOf([
      [1, 3, 0],
      [2, 2, 0],
      [3, 2, 0],
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { range: 3 }, out)), ['m2', 'm3']);
    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { range: 3, inclusive: true }, out)), ['m2', 'm3', 'm1']);
    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { range: 3, limit: 1 }, out)), ['m2']);
  });

  it('picks the candidate with the most units around it, with the cluster centroid', () => {
    const { world } = worldOf([
      [1, 1, 0],
      [2, 10, 0],
      [3, 11, 0],
      [4, 10, 1],
    ]);

    const cluster: Cluster<Mob> = { unit: undefined, count: 0, x: 0, z: 0 };

    world.densest(vec2(0, 0), { range: 20, radius: 2 }, cluster);
    assert.equal(cluster.unit?.name, 'm2');
    assert.equal(cluster.count, 3);
    assert.ok(Math.abs(cluster.x - 31 / 3) < 1e-12 && Math.abs(cluster.z - 1 / 3) < 1e-12);
  });

  it('keeps the first highest candidate on ties, and scores only up to the cap', () => {
    const { world } = worldOf([
      [1, 5, 0],
      [2, 6, 0],
      [3, -5, 0],
      [4, -6, 0],
      [5, -7, 0],
    ]);

    const cluster: Cluster<Mob> = { unit: undefined, count: 0, x: 0, z: 0 };

    world.densest(vec2(0, 0), { range: 20, radius: 1.5 }, cluster);
    assert.equal(cluster.unit?.name, 'm4');
    world.densest(vec2(0, 0), { range: 20, radius: 1.5, cap: 2 }, cluster);
    assert.equal(cluster.unit?.name, 'm1');
    assert.equal(cluster.count, 2);
    world.densest(vec2(40, 40), { range: 1, radius: 1.5 }, cluster);
    assert.equal(cluster.unit, undefined);
  });
});

describe('sweep: what a moving body touches', () => {
  it('reaches units in the order it meets them, and writes the shares', () => {
    const { world } = worldOf([
      [1, 8, 0, 0, 1],
      [2, 4, 0.5, 0, 1],
      [3, 4, 5, 0, 1],
    ]);

    const out: (Mob | undefined)[] = [];
    const shares: number[] = [];

    assert.deepEqual(names(out, world.sweep([vec2(0, 0), vec2(10, 0)], { radius: 0.5, shares }, out)), ['m2', 'm1']);
    assert.ok(Math.abs((shares[1] ?? 0) - 0.65) < 1e-12);
  });

  it('meets a unit that crossed the path during the tick only when relative', () => {
    const { world, mob } = worldOf([[1, 5, -5, 0, 0.5]]);
    const out: (Mob | undefined)[] = [];

    world.tick();
    world.place(mob(1), vec2(5, 5));
    assert.equal(world.sweep([vec2(0, 0), vec2(10, 0)], {}, out), 0);
    assert.equal(world.sweep([vec2(0, 0), vec2(10, 0)], { relative: true }, out), 1);
  });
});

describe('motion and the point index', () => {
  it('tracks previous positions and velocities over a tick', () => {
    const world = createMemoryWorld<Mob>({ bounds: BOUNDS, dt: 0.5 });
    const mob = { name: 'm1' };

    world.add(mob, { id: 1, at: vec2(0, 0) });
    world.tick();
    world.place(mob, vec2(1, 2));
    assert.deepEqual(world.previousOf(mob), { x: 0, z: 0 });
    assert.deepEqual(world.velocityOf(mob), { x: 2, z: 4 });
    world.tick();
    assert.deepEqual(world.velocityOf(mob), { x: 0, z: 0 });
  });

  it('finds units after they move between cells, and forgets removed ones', () => {
    const { world, mob } = worldOf([[1, 0, 0]]);
    const out: (Mob | undefined)[] = [];

    world.place(mob(1), vec2(30, 30));
    assert.equal(world.inside(circle(1), {}, out), 0);
    assert.equal(world.inside(circle(1, vec2(30, 30)), {}, out), 1);
    assert.equal(world.remove(mob(1)), true);
    assert.equal(world.remove(mob(1)), false);
    assert.equal(world.has(mob(1)), false);
    assert.equal(world.inside(circle(1, vec2(30, 30)), {}, out), 0);
  });

  it('keeps a unit outside the bounds findable at the nearest edge cell', () => {
    const { world } = worldOf([[1, 80, 0]]);
    const out: (Mob | undefined)[] = [];

    assert.equal(world.inside(circle(5, vec2(80, 0)), {}, out), 1);
  });

  it('refuses a unit added twice', () => {
    const { world, mob } = worldOf([[1, 0, 0]]);

    assert.throws(() => {
      world.add(mob(1), { id: 1, at: vec2(0, 0) });
    }, RangeError);
  });

  it('gives the same answers from the grid and the k-d tree', () => {
    const spot = fc.tuple(
      fc.integer({ min: -45, max: 45 }),
      fc.integer({ min: -45, max: 45 }),
      fc.integer({ min: 0, max: 1 }),
    );

    fc.assert(
      fc.property(fc.array(spot, { maxLength: 60 }), fc.integer({ min: 1, max: 30 }), (spots, r) => {
        const rows = spots.map(([x, z, side], id) => [id, x, z, side]);
        const grid = worldOf(rows, 'grid');
        const kd = worldOf(rows, 'kd');
        const a: (Mob | undefined)[] = [];
        const b: (Mob | undefined)[] = [];
        const shape = lane({ length: r, width: r / 2, dir: 0.7, back: 1 });

        assert.deepEqual(names(a, grid.world.inside(shape, {}, a)), names(b, kd.world.inside(shape, {}, b)));
        assert.deepEqual(
          names(a, grid.world.nearest(vec2(0, 0), { range: r }, a)),
          names(b, kd.world.nearest(vec2(0, 0), { range: r }, b)),
        );
      }),
    );
  });
});

describe('the memory world as a whole', () => {
  it('sorts long result lists the same as short ones', () => {
    const rows = Array.from({ length: 200 }, (_unused, i) => [199 - i, (i % 20) - 10, Math.floor(i / 20) - 5]);
    const { world } = worldOf(rows);
    const out: (Mob | undefined)[] = [];
    const count = world.all({}, out);

    assert.equal(count, 200);
    assert.deepEqual(
      names(out, count),
      Array.from({ length: 200 }, (_unused, i) => `m${i}`),
    );
  });

  it('stays usable detached', () => {
    const { world } = worldOf([[1, 0, 0]]);
    const { count, positionOf, has } = world;

    assert.equal(count(undefined, {}), 1);
    assert.equal(has({ name: 'x' }), false);
    assert.throws(() => positionOf({ name: 'x' }), RangeError);
  });

  it('is frozen', () => {
    const world: MemoryWorld<Mob> = createMemoryWorld<Mob>({ bounds: BOUNDS });

    assert.equal(Object.isFrozen(world), true);
    assert.deepEqual(world.extensions, []);
  });
});

describe('a limit of one and a count (no sort they do not need)', () => {
  it('keep the first unit the whole ordered query keeps, and count what it keeps, whatever the order', () => {
    const spot = fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 }), fc.nat(1));
    const order = fc.constantFrom('near', 'far', 'id' as const);

    fc.assert(
      fc.property(fc.array(spot, { maxLength: 40 }), order, (spots, by) => {
        const { world } = worldOf(spots.map(([x, z, side], id) => [id + 1, x, z, side, 0.5]));
        const all: (Mob | undefined)[] = [];
        const one: (Mob | undefined)[] = [];
        const options = { range: 15, order: by } as const;
        const kept = world.nearest(vec2(1, 2), options, all);

        assert.equal(world.nearest(vec2(1, 2), { ...options, limit: 1 }, one), Math.min(kept, 1));
        assert.equal(one[0], kept === 0 ? undefined : all[0]);
        assert.equal(world.count(circle(9, vec2(3, -1)), {}), world.inside(circle(9, vec2(3, -1)), {}, all));
      }),
    );
  });
});
