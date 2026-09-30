import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aura, makeGame, TAGS } from '../helpers/aura-game.ts';

const defs = {
  dash: aura({ duration: 2, predicted: true, tags: ['boon'], ownerOnly: true }),
  sprint: aura({ duration: 3, predicted: true, stacking: 'stack', maxStacks: 5, value: 4 }),
  stance: aura({ duration: 'infinite', predicted: true }),
  glow: aura({ duration: 5 }),
  spark: aura({ duration: 5, predicted: true, perSource: true, maxStacks: 8 }),
};

/** A server unit and a silent mirror of it. */
const setUp = () => {
  const game = makeGame(defs);
  const server = game.unit(1);

  const mirror = {
    id: 1,
    hp: 100,
    auras: game.auras.createState({ isSilent: true }),
  };

  return { ...game, server, mirror };
};

describe('seeding a prediction mirror', () => {
  it('rebuilds the predicted auras from the views with their stamps, and leaves the others out', () => {
    const { auras, id, server, mirror, run } = setUp();

    auras.apply(server, id.dash);
    auras.apply(server, { aura: id.sprint, stacks: 3, source: 9 });
    auras.apply(server, id.stance);
    auras.apply(server, id.glow);
    run(server, 4);
    run(mirror, 10);

    const seeded = auras.seed(mirror, {
      views: auras.view(server, { forOwner: true }),
      clocks: server.auras.clocks,
      serials: server.auras.serials,
    });

    assert.equal(seeded, 3);
    assert.deepEqual(
      auras
        .view(mirror, { forOwner: true })
        .map((view) => [view.aura, view.stacks, view.value, view.remaining, view.source]),
      [
        [id.dash, 1, 0, 1.5, -1],
        [id.sprint, 3, 4, 2.5, 9],
        [id.stance, 1, 0, Infinity, -1],
      ],
    );
    assert.equal(auras.has(mirror, id.glow), false);
    assert.equal(auras.hasTag(mirror, TAGS.id.boon), true);
    run(mirror, 11);
    assert.equal(auras.has(mirror, id.dash), true);
    run(mirror, 1);
    assert.equal(auras.has(mirror, id.dash), false);
  });

  it('replaces the mirror’s predicted auras and keeps the ones it is not sent', () => {
    const { auras, id, server, mirror } = setUp();

    auras.apply(mirror, id.dash);
    auras.apply(mirror, id.glow);
    auras.apply(server, id.sprint);

    assert.equal(
      auras.seed(mirror, { views: auras.view(server), clocks: server.auras.clocks, serials: server.auras.serials }),
      1,
    );
    assert.deepEqual(
      auras.view(mirror).map((view) => view.aura),
      [id.sprint, id.glow],
    );
    assert.equal(auras.hasTag(mirror, TAGS.id.boon), false);
  });

  it('counts serials per bearer, and goes on from the server’s count once seeded', () => {
    const { auras, id, server, mirror, unit } = setUp();
    const other = unit(2);

    auras.apply(other, { aura: id.spark, source: 1 });
    auras.apply(server, { aura: id.spark, source: 1 });
    auras.apply(server, { aura: id.spark, source: 2 });
    auras.apply(server, { aura: id.spark, source: 3 });
    auras.seed(mirror, { views: auras.view(server), clocks: server.auras.clocks, serials: server.auras.serials });
    auras.apply(server, { aura: id.spark, source: 4 });
    auras.apply(mirror, { aura: id.spark, source: 4 });
    assert.deepEqual(
      [other, server, mirror].map((bearer) => bearer.auras.list.map((item) => item.serial)),
      [[1], [1, 2, 3, 4], [1, 2, 3, 4]],
    );
  });

  it('says which auras are predicted, and seeds only a silent state', () => {
    const { auras, id, server } = setUp();

    assert.equal(auras.isPredicted(id.dash), true);
    assert.equal(auras.isPredicted(id.glow), false);
    assert.throws(() => auras.seed(server, { views: [], clocks: [], serials: 0 }), /Only a silent aura state/);
  });
});
