import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DIGEST_START } from '../../src/core/index.ts';
import { circle, polygon, vec2 } from '../../src/math/index.ts';
import { createMemoryWorld, type MemoryWorld } from '../../src/world/index.ts';

/** A test unit: its entity id. */
interface Mob {
  /** Its entity id. */
  readonly id: number;
}

const BOUNDS = { minX: -50, minZ: -50, maxX: 50, maxZ: 50 };

/** A world with mobs added in the given order: `[id, x, z, side, radius]`. */
const worldOf = (spots: readonly (readonly number[])[], keyed = false): MemoryWorld<Mob> => {
  const world = createMemoryWorld<Mob>(keyed ? { bounds: BOUNDS, idOf: (mob) => mob.id } : { bounds: BOUNDS });

  for (const [id = 0, x = 0, z = 0, side = 0, radius = 0] of spots) {
    world.add({ id }, { id, at: vec2(x, z), side, radius });
  }

  return world;
};

const SPOTS = [
  [4, 1, 2, 0, 0.5],
  [1, -3, 0, 1, 1],
  [9, 0, 7, 1, 0]
];

describe('the memory world digest', () => {
  it('is the same for the same bodies whatever order they came in, keyed by id or not', () => {
    const base = worldOf(SPOTS).digest(DIGEST_START);

    assert.equal(worldOf(SPOTS.toReversed()).digest(DIGEST_START), base);
    assert.equal(worldOf([SPOTS[1] ?? [], SPOTS[2] ?? [], SPOTS[0] ?? []], true).digest(DIGEST_START), base);
    assert.notEqual(worldOf(SPOTS.slice(1)).digest(DIGEST_START), base);
  });

  it('moves with a body’s position, previous position, side and radius', () => {
    const world = worldOf(SPOTS);
    const mob = { id: 20 };
    const digests = new Set<number>();

    const note = (): void => {
      const before = digests.size;

      digests.add(world.digest(DIGEST_START));
      assert.equal(digests.size, before + 1, 'each change moves the digest');
    };

    note();

    const empty = world.digest(DIGEST_START);

    world.add(mob, { id: 20, at: vec2(0, 0) });
    note();
    world.place(mob, vec2(1, 0));
    note();
    // The tick makes the previous position the current one: what relative sweeps read.
    world.tick();
    note();
    world.setSide(mob, 3);
    note();
    world.remove(mob);
    assert.equal(world.digest(DIGEST_START), empty, 'the body gone, the world is as it was');

    const narrower = worldOf([[4, 1, 2, 0, 0.25], ...SPOTS.slice(1)]);

    assert.notEqual(narrower.digest(DIGEST_START), worldOf(SPOTS).digest(DIGEST_START));
  });

  it('folds the statics by group name, whatever order the groups were set in', () => {
    const a = worldOf(SPOTS);
    const b = worldOf(SPOTS);
    const base = a.digest(DIGEST_START);
    const wall = polygon([vec2(0, 0), vec2(2, 0), vec2(2, 1)]);
    const pillar = circle(1, vec2(5, 5));

    a.setStatics([wall], 'walls');
    assert.notEqual(a.digest(DIGEST_START), base);
    a.setStatics([pillar], 'pillars');
    b.setStatics([pillar], 'pillars');
    b.setStatics([wall], 'walls');
    assert.equal(a.digest(DIGEST_START), b.digest(DIGEST_START));
    b.setStatics([pillar], 'walls');
    b.setStatics([wall], 'pillars');
    assert.notEqual(a.digest(DIGEST_START), b.digest(DIGEST_START), 'a group’s name shows');
    a.setStatics([], 'walls');
    a.setStatics([], 'pillars');
    assert.equal(a.digest(DIGEST_START), base);
  });
});
