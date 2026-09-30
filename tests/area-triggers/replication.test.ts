import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AnyAreaTriggerDef, AreaReplica } from '../../src/area-triggers/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { type Game, makeSpellGame } from '../helpers/spell-game.ts';

/** A kind of a radius and a lifetime. */
const kind = (r: number, def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
  shape: circle(r),
  lifetime: 4,
  ...def,
});

/** A game whose kinds replicate their state, only their events, or nothing the client cannot derive. */
const replicationGame = () =>
  makeSpellGame(
    {},
    {
      areaTriggers: {
        pool: kind(2.5, {
          replicate: {
            fields: ['x', 'z', 'radius', 'duration', 'age', 'started'],
            extra: ['charge'],
            rounding: { x: 0.5, charge: 0.25 },
          },
          view: (c) => ({ charge: (c.input ?? 0) / 3 }),
        }),
        shot: kind(0.5),
        ember: kind(1, { replicate: 'derived' }),
      },
    },
  );

describe('area trigger replication', () => {
  it('resolves each kind’s replication at load', () => {
    const game = replicationGame();
    const { replication } = game.areaTriggers.registry;

    assert.deepEqual(
      replication.map((spec) => spec.mode),
      ['state', 'events-only', 'derived'],
    );
    assert.deepEqual(replication[game.areaId.pool]?.names, [
      'x',
      'z',
      'radius',
      'duration',
      'age',
      'started',
      'charge',
    ]);
  });

  it('writes every live state-replicating area trigger’s values, rounded, in kind then creation order', () => {
    const game = replicationGame();
    const owner = game.unit(1);
    const out: AreaReplica[] = [];

    game.step(2);

    const first = game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(1.3, -2), input: 2 });

    game.areaTriggers.spawn(game.areaId.shot, { owner, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.ember, { owner, at: vec2(0, 0) });

    const second = game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(4, 4) });

    game.step();
    game.areaTriggers.step();
    assert.equal(game.areaTriggers.replicate(out), 2);
    assert.deepEqual(
      out.map((replica) => [replica.handle, replica.kind, ...replica.values]),
      [
        [first, game.areaId.pool, 1.5, -2, 2.5, 4, 0.25, 2, 0.75],
        [second, game.areaId.pool, 4, 4, 2.5, 4, 0.25, 2, 0],
      ],
    );

    const kept = out[0];

    game.areaTriggers.despawn(first);
    assert.equal(game.areaTriggers.replicate(out), 1);
    assert.equal(out[0], kept);
    assert.equal(out[0]?.handle, second);
  });

  it('refuses unknown or repeated fields, view entries with no view, and bad rounding', () => {
    const bad = (def: Partial<AnyAreaTriggerDef<Game>>) => () =>
      makeSpellGame({}, { areaTriggers: { bad: kind(1, def) } });

    const forged: Partial<AnyAreaTriggerDef<Game>> = {};

    Reflect.set(forged, 'replicate', { fields: ['x', 'colour'] });
    assert.throws(bad(forged), /Area trigger bad: replicates known fields/);
    assert.throws(bad({ replicate: { fields: ['x', 'x'] } }), /each once/);
    assert.throws(bad({ replicate: { fields: [] } }), /at least one/);
    assert.throws(bad({ replicate: { fields: ['x'], extra: ['goal'] } }), /declares no view/);
    assert.throws(bad({ replicate: { fields: ['x'], rounding: { z: 1 } } }), /rounds z/);
    assert.throws(bad({ replicate: { fields: ['x'], rounding: { x: 0 } } }), /quantum above 0/);
  });
});
