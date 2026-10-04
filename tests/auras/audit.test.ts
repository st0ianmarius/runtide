import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraView } from '../../src/auras/index.ts';
import { createClock, DIGEST_START } from '../../src/core/index.ts';
import { aura, makeGame, type Unit } from '../helpers/aura-game.ts';

const defs = {
  dash: aura({ duration: 2, predicted: true }),
  sprint: aura({ duration: 3, predicted: true, stacking: 'stack', maxStacks: 5, value: 4 }),
  spark: aura({ duration: 5, predicted: true, perSource: true }),
  bleed: aura({ duration: 4, clock: 'motion', periodic: { every: 0.5, onBeat: () => ['bled'] } })
};

/** Drives a game's unit through the same steps every time, `extra` changing one of them. */
const drive = (extra: (game: ReturnType<typeof makeGame<keyof typeof defs>>, unit: Unit) => void = () => {}) => {
  const game = makeGame(defs);
  const unit = game.unit(1);

  game.auras.apply(unit, { aura: game.id.sprint, stacks: 2, source: 3 });
  game.auras.apply(unit, { aura: game.id.spark, source: 7 });
  game.auras.apply(unit, game.id.bleed);
  game.run(unit, 3);
  game.run(unit, 2, 'motion');
  extra(game, unit);

  return game.auras.digest(unit, DIGEST_START);
};

describe('an aura state digest', () => {
  it('is equal for two games driven alike, and moves with any change a game can see', () => {
    assert.equal(drive(), drive());
    assert.notEqual(drive(), DIGEST_START);

    const changed = [
      drive((game, unit) => {
        game.run(unit, 1);
      }),
      drive((game, unit) => {
        game.run(unit, 1, 'motion');
      }),
      drive((game, unit) => game.auras.apply(unit, { aura: game.id.sprint, stacks: 1 })),
      drive((game, unit) => game.auras.spendValue(unit, game.id.sprint, 1)),
      drive((game, unit) => game.auras.refresh(unit, game.id.spark, 9)),
      drive((game, unit) => game.auras.apply(unit, { aura: game.id.spark, source: 8 })),
      drive((game, unit) => game.auras.remove(unit, game.id.bleed))
    ];

    assert.equal(new Set([drive(), ...changed]).size, changed.length + 1);
  });

  it('goes on from the hash it is handed', () => {
    const { auras, unit } = makeGame(defs);
    const a = unit(1);

    assert.notEqual(auras.digest(a, DIGEST_START), auras.digest(a, 1));
    assert.equal(auras.digest(a, 5), auras.digest(unit(2), 5));
  });
});

describe('the host and tick counts', () => {
  it('reads back the host it was built with', () => {
    const run = () => {};
    const { auras } = makeGame(defs, { host: { run } });

    assert.equal(auras.host.run, run);
    assert.equal(auras.host.onTagsChanged, undefined);
  });

  it('counts a bearer’s steps per clock on the clock’s current tick, and 0 once the tick moved on', () => {
    const world = createClock({ dt: 0.125 });
    const motion = createClock({ dt: 0.125 });
    const { auras, unit } = makeGame(defs, { clocks: { world, motion } });
    const a = unit(1);
    const b = unit(2);

    assert.deepEqual([auras.tickCount(a, 'world'), auras.tickCount(a, 'motion')], [0, 0]);
    auras.tickAll(a);
    auras.tick(a, 'world');
    auras.tick(b, 'motion');
    assert.deepEqual(
      [
        auras.tickCount(a, 'world'),
        auras.tickCount(a, 'motion'),
        auras.tickCount(b, 'world'),
        auras.tickCount(b, 'motion')
      ],
      [2, 1, 0, 1]
    );
    world.step();
    assert.deepEqual([auras.tickCount(a, 'world'), auras.tickCount(a, 'motion')], [0, 1]);
    auras.tick(a, 'world');
    assert.equal(auras.tickCount(a, 'world'), 1);
  });

  it('counts every step against tick 0 on a clock that reports no tick', () => {
    const { auras, unit, run } = makeGame(defs);
    const a = unit(1);

    run(a, 3);
    assert.equal(auras.tickCount(a, 'world'), 3);
  });
});

/** A bearer's aura views, in a fresh array. */
const viewsOf = (auras: ReturnType<typeof makeGame>['auras'], bearer: Unit): AuraView[] => {
  const out: AuraView[] = [];

  return out.slice(0, auras.view(bearer, out, { for: 'owner' }));
};

describe('a bearer header', () => {
  it('is what a mirror seeds from beside the views, matching the server after', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const server = unit(1);
    const mirror = unit(1, true);

    auras.apply(server, id.dash);
    auras.apply(server, { aura: id.spark, source: 4 });
    auras.apply(server, { aura: id.spark, source: 5 });
    run(server, 5);
    run(server, 2, 'motion');
    run(mirror, 9);

    const clocks: number[] = [];
    const header = auras.headerOf(server, { clocks, serials: -1 });

    assert.deepEqual(header, { clocks: [5, 2], serials: 2 });
    assert.equal(auras.headerOf(server, { clocks: new Float64Array(2), serials: 0 }).serials, 2);

    const seed = { views: viewsOf(auras, server), ...header };

    assert.equal(auras.seed(mirror, seed), 3);
    assert.equal(auras.matchesSeed(mirror, seed), true);
    assert.equal(auras.remaining(mirror, id.dash), auras.remaining(server, id.dash));
    assert.equal(auras.remaining(mirror, id.spark), auras.remaining(server, id.spark));
  });

  it('refuses a typed array too short for every clock', () => {
    const { auras, unit } = makeGame(defs);

    assert.throws(() => auras.headerOf(unit(1), { clocks: new Float64Array(1), serials: 0 }), /room for 2 clocks/);
  });

  it('refuses a seed whose header is not a server’s, changing nothing', () => {
    const { auras, id, unit } = makeGame(defs);
    const server = unit(1);
    const mirror = unit(1, true);

    auras.apply(server, { aura: id.spark, source: 4 });
    auras.apply(server, { aura: id.spark, source: 5 });
    auras.apply(mirror, id.dash);

    const views = viewsOf(auras, server);

    const bad: [{ readonly clocks: readonly number[]; readonly serials: number }, RegExp][] = [
      [{ clocks: [0], serials: 2 }, /all 2 clocks; got 1/],
      [{ clocks: [], serials: 2 }, /all 2 clocks; got 0/],
      [{ clocks: [0, 0.5], serials: 2 }, /clock 1 must be a whole number/],
      [{ clocks: [-1, 0], serials: 2 }, /clock 0 must be a whole number/],
      [{ clocks: [0, 0], serials: Number.NaN }, /serials must be a whole number/],
      [{ clocks: [0, 0], serials: 1.5 }, /serials must be a whole number/],
      [{ clocks: [0, 0], serials: 1 }, /serials \(1\) are below its view 1's serial \(2\)/]
    ];

    for (const [header, message] of bad) {
      assert.throws(() => auras.seed(mirror, { views, ...header }), message);
      assert.throws(() => auras.matchesSeed(mirror, { views, ...header }), message);
    }

    assert.deepEqual(
      mirror.auras.list.map((item) => item.id),
      [id.dash]
    );
    assert.equal(auras.seed(mirror, { views, clocks: [0, 0], serials: 2 }), 2);
  });
});
