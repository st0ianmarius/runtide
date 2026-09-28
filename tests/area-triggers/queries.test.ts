import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AnyAreaTriggerDef,
  type AreaInterception,
  type AreaQuery,
  type AreaTriggerHandle,
  NO_AREA_TRIGGER,
} from '../../src/area-triggers/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { type Game, makeSpellGame } from '../helpers/spell-game.ts';

/** A kind of a radius, tagged, with a view of its input. */
const kind = (r: number, def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
  shape: circle(r),
  lifetime: 10,
  ...def,
});

/** A game with domes, pools and a plain kind. */
const queryGame = () =>
  makeSpellGame(
    {},
    {
      areaTriggers: {
        dome: kind(2, { tags: ['dome'], view: (c) => ({ charge: c.input ?? 0 }) }),
        pool: kind(1, { tags: ['pool'] }),
        plain: kind(1),
      },
    },
  );

/** The handles a query of a game keeps. */
const handlesOf = (game: ReturnType<typeof queryGame>, query: Parameters<typeof game.areaTriggers.query>[0]) => {
  const out: AreaTriggerHandle[] = [];

  return out.slice(0, game.areaTriggers.query(query, out));
};

describe('queries over area triggers (§II.6 W5)', () => {
  it('keeps by kind, owner, tag and condition, in kind order then creation order', () => {
    const game = queryGame();
    const [one, two] = [game.unit(1), game.unit(2)];
    const pool = game.areaTriggers.spawn(game.areaId.pool, { owner: one, at: vec2(0, 0) });
    const domeA = game.areaTriggers.spawn(game.areaId.dome, { owner: two, at: vec2(0, 0), input: 1 });
    const domeB = game.areaTriggers.spawn(game.areaId.dome, { owner: one, at: vec2(5, 0), input: 2 });

    assert.deepEqual(handlesOf(game, {}), [domeA, domeB, pool]);
    assert.deepEqual(handlesOf(game, { owner: one }), [domeB, pool]);
    assert.deepEqual(handlesOf(game, { tag: 'pool' }), [pool]);
    assert.deepEqual(handlesOf(game, { kind: game.areaId.dome, filter: (c) => c.position.x > 1 }), [domeB]);
    const forged: AreaQuery<Game> = {};

    Reflect.set(forged, 'tag', 'wall');
    assert.throws(() => handlesOf(game, forged), /unknown area trigger tag wall/);
  });

  it('reads a kind’s declared view, and nothing for one without a view or once it ended', () => {
    const game = queryGame();
    const owner = game.unit(1);
    const dome = game.areaTriggers.spawn(game.areaId.dome, { owner, at: vec2(0, 0), input: 7 });
    const pool = game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0) });

    assert.deepEqual(game.areaTriggers.viewOf(dome), { charge: 7 });
    assert.equal(game.areaTriggers.viewOf(pool), undefined);
    game.areaTriggers.despawn(dome);
    assert.equal(game.areaTriggers.viewOf(dome), undefined);
  });

  it('despawns a chosen subset with a reason', () => {
    const game = queryGame();
    const [one, two] = [game.unit(1), game.unit(2)];

    game.areaTriggers.spawn(game.areaId.pool, { owner: one, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.pool, { owner: two, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.dome, { owner: one, at: vec2(0, 0) });
    assert.equal(game.areaTriggers.despawnWhere({ owner: one }, 'bound'), 2);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('ended')),
      ['ended dome@1 bound', 'ended pool@1 bound'],
    );
    assert.equal(game.areaTriggers.pool.live, 1);
  });
});

describe('coveredBy and interceptors (§II.6 W5)', () => {
  it('finds the first area trigger with a tag covering a point, for a body’s radius', () => {
    const game = queryGame();
    const owner = game.unit(1);

    game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0) });

    const dome = game.areaTriggers.spawn(game.areaId.dome, { owner, at: vec2(0, 0) });

    game.areaTriggers.spawn(game.areaId.dome, { owner, at: vec2(1, 0) });
    assert.equal(game.areaTriggers.coveredBy(vec2(0.5, 0), { tag: 'dome' }), dome);
    assert.equal(game.areaTriggers.coveredBy(vec2(4, 0), { tag: 'dome' }), NO_AREA_TRIGGER);
    assert.notEqual(game.areaTriggers.coveredBy(vec2(4, 0), { tag: 'dome', radius: 1.5 }), NO_AREA_TRIGGER);
  });

  it('finds where a path first meets an area trigger with a tag, the first on ties', () => {
    const game = queryGame();
    const owner = game.unit(1);
    const out: AreaInterception = { handle: NO_AREA_TRIGGER, share: 1 };
    const far = game.areaTriggers.spawn(game.areaId.dome, { owner, at: vec2(8, 0) });
    const near = game.areaTriggers.spawn(game.areaId.dome, { owner, at: vec2(4, 0) });

    game.areaTriggers.intercept([vec2(0, 0), vec2(10, 0)], { tag: 'dome' }, out);
    assert.equal(out.handle, near);
    assert.equal(out.share, 0.2);
    game.areaTriggers.intercept([vec2(0, 5), vec2(10, 5)], { tag: 'dome' }, out);
    assert.deepEqual(out, { handle: NO_AREA_TRIGGER, share: 1 });
    game.areaTriggers.despawn(near);
    game.areaTriggers.intercept([vec2(0, 0), vec2(10, 0)], { kind: game.areaId.dome }, out);
    assert.equal(out.handle, far);
  });

  it('lets a hook ask about other area triggers through c.areas', () => {
    const seen: number[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          tempest: kind(1, {
            view: (c) => ({ goal: c.id * 10 }),

            frame: (c) => {
              const out: AreaTriggerHandle[] = [];
              const count = c.areas.query({ kind: c.kind, filter: (other) => other.id !== c.id }, out);

              for (const handle of out.slice(0, count)) {
                seen.push(c.areas.viewOf(handle)?.['goal'] ?? -1);
              }

              return undefined;
            },
          }),
        },
      },
    );

    const owner = game.unit(1);

    game.areaTriggers.spawn(game.areaId.tempest, { owner, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.tempest, { owner, at: vec2(0, 0) });
    game.step();
    game.areaTriggers.step();
    assert.deepEqual(seen, [20, 10]);
  });
});
