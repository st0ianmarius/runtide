import { stream } from '../src/core/index.ts';
import { circle, secondsInside, vec2 } from '../src/math/index.ts';
import { type Cluster, createMemoryWorld, type MemoryWorld } from '../src/world/index.ts';

/** A bench unit: its place, which it wanders from each tick. */
interface Mob {
  /** Its x. */
  x: number;

  /** Its z. */
  z: number;
}

/** How many units the bench worlds hold. */
const UNITS = 2000;

/** The bench worlds' bounds: 200 m square, so 2,000 units stand about 4.5 m apart. */
const BOUNDS = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };

/** How many results the bench queries found, so no call is optimised away. */
export const worldCounter = { found: 0 };

const random = stream(4242);

/** The bench units, spread evenly at random, half on each side. */
const MOBS: readonly Mob[] = Array.from({ length: UNITS }, () => ({
  x: (random() - 0.5) * 190,
  z: (random() - 0.5) * 190,
}));

/** A world over the bench units, with the point index given. */
const worldOf = (index: 'grid' | 'kd'): MemoryWorld<Mob> => {
  const world = createMemoryWorld<Mob>({ bounds: BOUNDS, index, cell: 4, dt: 1 / 30 });

  for (const [id, mob] of MOBS.entries()) {
    world.add(mob, { id: id + 1, at: vec2(mob.x, mob.z), radius: 0.5, side: id % 2 });
  }

  return world;
};

const GRID = worldOf('grid');

/** A horde crowding its target: 2,000 foes within 30 m of the hero at the origin (the review after F21, P6). */
const CROWD = createMemoryWorld<Mob>({ bounds: BOUNDS, cell: 4, dt: 1 / 30 });
const HERO: Mob = { x: 0, z: 0 };

CROWD.add(HERO, { id: 1, at: vec2(0, 0), radius: 0.5, side: 0 });

for (let id = 0; id < UNITS; id++) {
  const angle = random() * Math.PI * 2;
  const r = 1 + Math.sqrt(random()) * 29;

  CROWD.add({ x: 0, z: 0 }, { id: id + 2, at: vec2(Math.cos(angle) * r, Math.sin(angle) * r), radius: 0.5, side: 1 });
}

const CROWD_NEAR = { side: 'foes', of: HERO, range: 30, limit: 1 } as const;
const KD = worldOf('kd');
const OUT: (Mob | undefined)[] = [];
const CLUSTER: Cluster<Mob> = { unit: undefined, count: 0, x: 0, z: 0 };
const CASTER = MOBS[0] ?? { x: 0, z: 0 };
const FOES = { side: 'foes', of: CASTER } as const;
const NEAR = { ...FOES, range: 10, limit: 1 } as const;
const DENSE = { ...FOES, range: 15, radius: 3, cap: 16 } as const;
const SWEEP = { ...FOES, radius: 0.5 } as const;
const SEGMENT = [vec2(-20, 0), vec2(20, 0)] as const;
const CIRCLE = circle(6, vec2(10, 10));
let step = 0;

/** Every unit wanders a little: what a tick of movement costs the point index. */
const wander = (world: MemoryWorld<Mob>): void => {
  step += 1;
  world.tick();

  for (let id = 0; id < MOBS.length; id++) {
    const mob = MOBS[id] ?? { x: 0, z: 0 };
    const turn = ((id * 7 + step) % 16) - 8;

    mob.x = Math.max(-99, Math.min(99, mob.x + turn * 0.02));
    mob.z = Math.max(-99, Math.min(99, mob.z - turn * 0.015));
    world.place(mob, mob);
  }
};

/** The F8 world benchmark tasks, and how many operations each call of its function is. */
export const WORLD_TASKS: readonly (readonly [string, () => void, number])[] = [
  [
    'world: inside r 6, 2,000 units (grid)',
    () => {
      worldCounter.found += GRID.inside(CIRCLE, FOES, OUT);
    },
    1,
  ],
  [
    'world: nearest foe in a crowd, 2,000 within 30 m (grid)',
    () => {
      worldCounter.found += CROWD.nearest(HERO, CROWD_NEAR, OUT);
    },
    1,
  ],
  [
    'world: nearest foe in 10 m (grid)',
    () => {
      worldCounter.found += GRID.nearest(CASTER, NEAR, OUT);
    },
    1,
  ],
  [
    'world: densest r 3 in 15 m, cap 16 (grid)',
    () => {
      worldCounter.found += GRID.densest(CASTER, DENSE, CLUSTER).count;
    },
    1,
  ],
  [
    'world: sweep 40 m, body 0.5 (grid)',
    () => {
      worldCounter.found += GRID.sweep(SEGMENT, SWEEP, OUT);
    },
    1,
  ],
  [
    'world: 2,000 units move, grid updated (tick)',
    () => {
      wander(GRID);
    },
    1000,
  ],
  [
    'world: 2,000 units move, k-d rebuilt + a query (tick)',
    () => {
      wander(KD);
      worldCounter.found += KD.inside(CIRCLE, FOES, OUT);
    },
    1000,
  ],
  [
    'world: seconds inside a ring over one tick',
    () => {
      worldCounter.found += secondsInside(CIRCLE, { from: vec2(0, 10), to: vec2(20, 10), t0: 0, t1: 1 / 30 });
    },
    1,
  ],
];
