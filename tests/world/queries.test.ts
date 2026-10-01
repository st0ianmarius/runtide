import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { circle, lane, ring, vec2 } from '../../src/math/index.ts';
import { createMemoryWorld, type MemoryWorld } from '../../src/world/index.ts';

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
      [4, -1, -1]
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(2), {}, out)), ['m1', 'm3', 'm4']);

    const unordered: (Mob | undefined)[] = [];
    const count = world.inside(circle(2), { order: 'none' }, unordered);

    assert.deepEqual(names(unordered, count).toSorted(), ['m1', 'm3', 'm4']);
    assert.equal(world.inside(circle(2), { order: 'none', limit: 2 }, unordered), 2);

    for (const limit of [-1, 1.5, Number.NaN]) {
      assert.throws(() => world.inside(circle(2), { limit }, out), /limit is a whole number from 0/);
    }
  });

  it('keeps a crowd in id order too, and refuses an id that is not a whole number from 0', () => {
    const ids = Array.from({ length: 120 }, (_unused, i) => (i * 7919) % 100_003);
    const { world } = worldOf(ids.map((id, i) => [id, (i % 11) - 5, Math.floor(i / 11) - 5]));
    const out: (Mob | undefined)[] = [];
    const count = world.inside(circle(30), {}, out);

    assert.deepEqual(
      names(out, count),
      [...ids].sort((a, b) => a - b).map((id) => `m${id}`)
    );
    assert.throws(() => {
      world.add({ name: 'x' }, { id: -1, at: vec2(0, 0) });
    }, /whole number from 0/);
    assert.throws(() => {
      world.add({ name: 'y' }, { id: 1.5, at: vec2(0, 0) });
    }, /whole number from 0/);
  });

  it('reaches bodies by their radius when measured to the edge', () => {
    const { world } = worldOf([
      [1, 3, 0, 0, 0.5],
      [2, 3, 0.1, 0, 1.5]
    ]);

    const out: (Mob | undefined)[] = [];

    assert.equal(world.inside(circle(2), {}, out), 0);
    assert.deepEqual(names(out, world.inside(circle(2), { measure: 'edge' }, out)), ['m2']);
  });

  it('ranks near and far as it measures: a large body nearer by its edge comes first', () => {
    // A small body whose edge is 2.9 away, and a large one whose edge is 2 away though its centre is farther.
    const { world } = worldOf([
      [1, 3, 0, 0, 0.1],
      [2, 5, 0, 0, 3]
    ]);

    const out: (Mob | undefined)[] = [];
    const edge = { range: 4, measure: 'edge' } as const;

    assert.deepEqual(names(out, world.nearest(vec2(0, 0), edge, out)), ['m2', 'm1']);
    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { ...edge, limit: 1 }, out)), ['m2']);
    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { ...edge, order: 'far' }, out)), ['m1', 'm2']);
    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { range: 6, limit: 1 }, out)), ['m1']);
  });

  it('keeps foes or allies relative to the unit asking, and refuses a side without one', () => {
    const { world, mob } = worldOf([
      [1, 0, 0, 0],
      [2, 1, 0, 1],
      [3, 0, 1, 0],
      [4, 1, 1, 1]
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(5), { side: 'foes', of: mob(1) }, out)), ['m2', 'm4']);
    assert.deepEqual(names(out, world.inside(circle(5), { side: 'allies', of: mob(1) }, out)), ['m1', 'm3']);
    assert.throws(() => world.inside(circle(5), { side: 'foes' }, out), RangeError);
  });

  it("reads the game's reaction rule: side 2 is everyone's foe and its own, side 3 neutral to all", () => {
    const world = createMemoryWorld<Mob>({
      bounds: BOUNDS,

      reaction: (a, b) => {
        if (a === 2 || b === 2) {
          return 'hostile';
        }

        if (a === 3 || b === 3) {
          return 'neutral';
        }

        return a === b ? 'friendly' : 'hostile';
      }
    });

    const [hero, mob, hazard, other, critter] = [
      { name: 'h' },
      { name: 'm' },
      { name: 'z' },
      { name: 'o' },
      { name: 'c' }
    ];

    world.add(hero, { id: 1, at: vec2(0, 0), side: 0 });
    world.add(mob, { id: 2, at: vec2(1, 0), side: 1 });
    world.add(hazard, { id: 3, at: vec2(0, 1), side: 2 });
    world.add(other, { id: 4, at: vec2(1, 1), side: 2 });
    world.add(critter, { id: 5, at: vec2(-1, 0), side: 3 });

    const out: (Mob | undefined)[] = [];

    const query = (side: 'foes' | 'allies' | 'attackable', of: Mob) =>
      names(out, world.inside(circle(5), { side, of }, out));

    assert.deepEqual(query('foes', hero), ['m', 'z', 'o']);
    assert.deepEqual(query('attackable', hero), ['m', 'z', 'o', 'c']);
    assert.deepEqual(query('allies', hero), ['h']);
    assert.deepEqual(query('foes', hazard), ['h', 'm', 'z', 'o', 'c']);
    assert.deepEqual(query('allies', hazard), []);
    assert.deepEqual(
      [world.reactionOf(hero, mob), world.reactionOf(hero, hero), world.reactionOf(hero, critter)],
      ['hostile', 'friendly', 'neutral']
    );
  });

  it('moves a unit to another side, and takes the side from ofSide for an asker with no place', () => {
    const { world, mob } = worldOf([
      [1, 0, 0, 0],
      [2, 1, 0, 1],
      [3, 0, 1, 1]
    ]);

    const out: (Mob | undefined)[] = [];

    world.setSide(mob(3), 0);
    assert.deepEqual(names(out, world.inside(circle(5), { side: 'foes', of: mob(1) }, out)), ['m2']);
    assert.deepEqual(names(out, world.inside(circle(5), { side: 'foes', of: { name: 'x' }, ofSide: 1 }, out)), [
      'm1',
      'm3'
    ]);
  });

  it("leaves out whom the game's targeting rule says the asker may not pick", () => {
    const world = createMemoryWorld<Mob>({
      bounds: BOUNDS,
      canTarget: (by, unit) => by.name === 'seer' || unit.name !== 'shade'
    });

    const [seer, grunt, shade] = [{ name: 'seer' }, { name: 'grunt' }, { name: 'shade' }];

    world.add(seer, { id: 1, at: vec2(0, 0), side: 0 });
    world.add(grunt, { id: 2, at: vec2(1, 0), side: 0 });
    world.add(shade, { id: 3, at: vec2(0, 1), side: 1 });

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(5), { of: grunt }, out)), ['seer', 'grunt']);
    assert.deepEqual(names(out, world.inside(circle(5), { of: seer }, out)), ['seer', 'grunt', 'shade']);
    assert.deepEqual(names(out, world.inside(circle(5), {}, out)), ['seer', 'grunt', 'shade']);
  });

  it('leaves out an exclude set and what fails the filter', () => {
    const { world, mob } = worldOf([
      [1, 0, 0],
      [2, 1, 0],
      [3, 2, 0]
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
      [1, 2, 0]
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
      'm3'
    ]);
  });

  it('breaks ties of infinite scores by id and sorts NaN scores last, however the units were added', () => {
    const spots = Array.from({ length: 40 }, (_unit, id) => [id, id % 3, 0]);
    const forward = worldOf(spots).world;
    const backward = worldOf([...spots].reverse()).world;

    const score = (unit: Mob): number => {
      const id = Number(unit.name.slice(1));

      if (id % 5 === 0) {
        return Number.NaN;
      }

      return id % 2 === 0 ? Infinity : 1;
    };

    const a: (Mob | undefined)[] = [];
    const b: (Mob | undefined)[] = [];
    const count = forward.all({ order: score }, a);

    assert.deepEqual(names(a, count), names(b, backward.all({ order: score }, b)));
    assert.deepEqual(names(a, 3), ['m1', 'm3', 'm7']);
    assert.equal(a[count - 1]?.name, 'm35');
  });

  it('answers a query a filter runs inside another, each with its own scratch', () => {
    const { world } = worldOf(Array.from({ length: 10 }, (_unit, id) => [id + 1, id * 2, 0]));
    const out: (Mob | undefined)[] = [];

    const count = world.inside(circle(40), { filter: () => world.count(circle(1, vec2(0, 0)), {}) === 1 }, out);

    assert.equal(count, 10);
  });

  it('caps the results at the limit, in order', () => {
    const { world } = worldOf([
      [1, 0, 0],
      [2, 1, 0],
      [3, 2, 0],
      [4, 3, 0],
      [5, 4, 0]
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.inside(circle(9), { limit: 2 }, out)), ['m1', 'm2']);
    assert.equal(world.count(circle(9), { limit: 4 }), 4);
  });

  it('filters the whole world with no shape', () => {
    const { world } = worldOf([
      [2, 40, 40],
      [1, -40, -40]
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.all({}, out)), ['m1', 'm2']);
    assert.equal(world.count(undefined, {}), 2);
    assert.equal(world.count(ring(1, 2), {}), 0);
  });
});

describe('nearest', () => {
  it('finds the nearest within a range, the rim counting only when inclusive', () => {
    const { world } = worldOf([
      [1, 3, 0],
      [2, 2, 0],
      [3, 2, 0]
    ]);

    const out: (Mob | undefined)[] = [];

    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { range: 3 }, out)), ['m2', 'm3']);
    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { range: 3, inclusive: true }, out)), ['m2', 'm3', 'm1']);
    assert.deepEqual(names(out, world.nearest(vec2(0, 0), { range: 3, limit: 1 }, out)), ['m2']);
  });
});

describe('sweep: what a moving body touches', () => {
  it('reaches units in the order it meets them, and writes the shares', () => {
    const { world } = worldOf([
      [1, 8, 0, 0, 1],
      [2, 4, 0.5, 0, 1],
      [3, 4, 5, 0, 1]
    ]);

    const out: (Mob | undefined)[] = [];
    const shares: number[] = [];

    assert.deepEqual(names(out, world.sweep(vec2(0, 0), vec2(10, 0), { radius: 0.5, shares }, out)), ['m2', 'm1']);
    assert.ok(Math.abs((shares[1] ?? 0) - 0.65) < 1e-12);
  });

  it('meets a unit that crossed the path during the tick only when relative', () => {
    const { world, mob } = worldOf([[1, 5, -5, 0, 0.5]]);
    const out: (Mob | undefined)[] = [];

    world.tick();
    world.place(mob(1), vec2(5, 5));
    assert.equal(world.sweep(vec2(0, 0), vec2(10, 0), {}, out), 0);
    assert.equal(world.sweep(vec2(0, 0), vec2(10, 0), { relative: true }, out), 1);
  });
});

describe('motion and the point index', () => {
  it('tracks previous positions and velocities over a tick', () => {
    const world = createMemoryWorld<Mob>({ bounds: BOUNDS, dt: 0.5 });
    const mob = { name: 'm1' };

    world.add(mob, { id: 1, at: vec2(0, 0) });
    world.tick();
    world.place(mob, vec2(1, 2));
    assert.deepEqual(world.previousOf(mob, { x: 0, z: 0 }), { x: 0, z: 0 });
    assert.deepEqual(world.velocityOf(mob, { x: 0, z: 0 }), { x: 2, z: 4 });
    world.tick();
    assert.deepEqual(world.velocityOf(mob, { x: 0, z: 0 }), { x: 0, z: 0 });
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
      fc.integer({ min: 0, max: 1 })
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
          names(b, kd.world.nearest(vec2(0, 0), { range: r }, b))
        );
      })
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
      Array.from({ length: 200 }, (_unused, i) => `m${i}`)
    );
  });

  it('stays usable detached', () => {
    const { world } = worldOf([[1, 0, 0]]);
    const { count, positionOf, has } = world;

    assert.equal(count(undefined, {}), 1);
    assert.equal(has({ name: 'x' }), false);
    assert.throws(() => positionOf({ name: 'x' }, { x: 0, z: 0 }), RangeError);
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
      })
    );
  });
});

/** A unit that keeps the slot a world gives it. */
interface Slotted {
  readonly id: number;
  slot: number;
}

describe('a world that finds units by their entity id', () => {
  it('answers as one keyed by unit, and so does one keeping slots on units, and refuses an id idOf does not give', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 300 })), { maxLength: 400 }), (steps) => {
        const byId = createMemoryWorld<Slotted>({ bounds: BOUNDS, idOf: (unit) => unit.id });
        const plain = createMemoryWorld<Slotted>({ bounds: BOUNDS });

        const kept = createMemoryWorld<Slotted>({
          bounds: BOUNDS,

          slots: {
            get: (unit) => unit.slot,

            set: (unit, slot) => {
              unit.slot = slot;
            }
          }
        });

        const units = new Map<number, Slotted>();

        for (const [isAdd, id] of steps) {
          const unit = units.get(id) ?? { id, slot: -1 };

          units.set(id, unit);

          if (isAdd && !plain.has(unit)) {
            byId.add(unit, { id, at: vec2(id % 40, 0) });
            plain.add(unit, { id, at: vec2(id % 40, 0) });
            kept.add(unit, { id, at: vec2(id % 40, 0) });
          } else if (!isAdd) {
            const removed = plain.remove(unit);

            assert.equal(byId.remove(unit), removed);
            assert.equal(kept.remove(unit), removed);
          }
        }

        const a: (Slotted | undefined)[] = [];
        const b: (Slotted | undefined)[] = [];
        const c: (Slotted | undefined)[] = [];

        const count = plain.all({}, b);

        assert.equal(byId.all({}, a), count);
        assert.equal(kept.all({}, c), count);
        assert.deepEqual(a, b);
        assert.deepEqual(c, b);
        assert.ok([...units.values()].every((unit) => byId.has(unit) === plain.has(unit)));
        assert.ok([...units.values()].every((unit) => kept.has(unit) === plain.has(unit)));
      })
    );

    const world = createMemoryWorld<{ readonly id: number }>({ bounds: BOUNDS, idOf: (unit) => unit.id });

    assert.throws(() => {
      world.add({ id: 3 }, { id: 4, at: vec2(0, 0) });
    }, /idOf does not give/);
    world.add({ id: 3 }, { id: 3, at: vec2(0, 0) });
    assert.throws(() => {
      world.add({ id: 3 }, { id: 3, at: vec2(0, 0) });
    }, /already in the world/);
    assert.equal(world.has({ id: 3 }), false);
  });
});
