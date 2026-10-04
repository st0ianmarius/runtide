import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { digest, DIGEST_START } from '../../src/core/digest.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { aura, makeSpellGame, TICK_SLOTS } from '../helpers/spell-game.ts';

/** A game with a pulsing pool keeping a ledger, a field keeping an aura, and a missile flying through. */
const makeGame = () =>
  makeSpellGame(
    {},
    {
      auras: { chilled: aura({ duration: 'infinite' }) },
      areaTriggers: {
        pool: {
          shape: circle(2),
          lifetime: 10,
          ledgers: { hits: { policy: 'rehit', cooldown: 0.5 } },
          every: [{ seconds: 0.25, ledger: 'hits', onPulse: () => undefined }]
        },
        field: { shape: circle(2), lifetime: 10, auras: [{ aura: 'chilled' }] },
        missile: {
          shape: circle(0.5),
          lifetime: 3,
          ledgers: { pierced: { policy: 'once' } },
          contact: { radius: 0.5, ledger: 'pierced' },

          move: (c, dt) => {
            c.position.x += 4 * dt;
          },

          onContact: () => undefined
        }
      }
    }
  );

/**
 * A game driven through one spawn of each kind with two units nearby, the second unit at `x`, and the handles of its
 * pool, field and missile.
 */
const driven = (x = 1, ticks = 4) => {
  const game = makeGame();

  game.place(game.unit(100), vec2(0, 0));
  game.place(game.unit(101), vec2(x, 0));

  const handles = [game.areaId.pool, game.areaId.field, game.areaId.missile].map((kind) =>
    game.areaTriggers.spawn(kind, { owner: game.unit(1), at: vec2(0, 0) })
  );

  for (let i = 0; i < ticks; i++) {
    game.step();
    game.areaTriggers.step();
  }

  return { game, handles };
};

/** A game's area trigger digest from the start. */
const digestOf = (game: Pick<ReturnType<typeof makeGame>, 'areaTriggers'>): number =>
  game.areaTriggers.digest(DIGEST_START);

describe('area trigger digest', () => {
  it('folds no area triggers as their count alone', () => {
    assert.equal(digestOf(makeGame()), digest(DIGEST_START, 0));
  });

  it('is equal for identically driven games, tick by tick', () => {
    for (const ticks of [0, 1, 3, 8]) {
      assert.equal(digestOf(driven(1, ticks).game), digestOf(driven(1, ticks).game));
    }

    assert.notEqual(digestOf(driven(1, 3).game), digestOf(driven(1, 4).game));
  });

  it('changes with what was hit and who stands inside', () => {
    assert.notEqual(digestOf(driven(1).game), digestOf(driven(9).game));
  });

  it('changes with lifetime left, position and heading', () => {
    const base = digestOf(driven().game);

    const changes = [
      (c: { position: { x: number }; heading: number }) => {
        c.position.x += 0.5;
      },
      (c: { position: { x: number }; heading: number }) => {
        c.heading += 0.25;
      }
    ];

    for (const change of changes) {
      const { game, handles } = driven();
      const area = game.areaTriggers.get(handles[0] ?? game.areaTriggers.current);

      assert.ok(area !== undefined);
      change(area);
      assert.notEqual(digestOf(game), base);
    }

    const { game, handles } = driven();

    assert.ok(game.areaTriggers.setRemaining(handles[1] ?? game.areaTriggers.current, 1));
    assert.notEqual(digestOf(game), base);
  });

  it('drops an area trigger as it ends', () => {
    const { game, handles } = driven();
    const before = digestOf(game);

    assert.ok(game.areaTriggers.despawn(handles[0] ?? game.areaTriggers.current));
    assert.notEqual(digestOf(game), before);
  });

  it('goes on from a hash it is given', () => {
    const { game } = driven();

    assert.notEqual(game.areaTriggers.digest(1), game.areaTriggers.digest(2));
  });
});

describe('area trigger slot audit', () => {
  it('counts its slots and says which ones step ran on this tick', () => {
    const game = makeGame();
    const { areaTriggers } = game;
    const late = TICK_SLOTS.id.late;

    assert.equal(areaTriggers.slots, 2);
    assert.equal(areaTriggers.stepped(), false);
    areaTriggers.step();
    assert.equal(areaTriggers.stepped(), true);
    assert.equal(areaTriggers.stepped(late), false);
    areaTriggers.stepOwner(game.unit(1), late);
    assert.equal(areaTriggers.stepped(late), false);
    game.step();
    assert.equal(areaTriggers.stepped(), false);
  });
});
