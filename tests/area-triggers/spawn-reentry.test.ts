import assert from 'node:assert/strict';
import { test } from 'node:test';

import { circle } from '../../src/math/index.ts';
import { add, finishScaled, scaled } from '../../src/modifiers/index.ts';
import { makeSpellGame, STATS } from '../helpers/spell-game.ts';

test('an area ended by its owner aura never runs init afterward', () => {
  const seen: string[] = [];

  const g = makeSpellGame(
    {},
    {
      auras: {
        holding: {
          duration: 'infinite',

          onApplied: (ctx) => {
            g.areaTriggers.despawnWhere({ owner: ctx.bearer });
          }
        }
      },
      areaTriggers: {
        zone: {
          shape: circle(1),
          lifetime: 1,
          ownerAura: 'holding',

          init: () => {
            seen.push('init');
          },

          onEnd: () => {
            seen.push('end');
          }
        }
      }
    }
  );

  g.areaTriggers.spawn(g.areaId.zone, { owner: g.unit(1), at: { x: 0, z: 0 } });
  assert.deepEqual(seen, ['end']);
  assert.equal(g.areaTriggers.pool.live, 0);
  assert.equal(
    g.log.some((line) => line.startsWith('spawned zone')),
    false
  );
});

test('an area keeps the stats it captured when its live cast later refreshes', () => {
  const g = makeSpellGame(
    {
      shot: {
        activation: { kind: 'trigger' },
        live: true,
        stats: { power: scaled(0, add('power', 1), add('maxHealth', 0.1, { from: 'target' })) },
        timeline: { windup: { seconds: 1 } },
        release: () => undefined
      }
    },
    { areaTriggers: { zone: { shape: circle(1), lifetime: 2 } } }
  );

  const owner = g.unit(1);
  const cast = g.spells.cast(owner, g.id.shot).handle;
  const area = g.areaTriggers.spawn(g.areaId.zone, { owner, at: { x: 0, z: 0 }, cast });
  const captured = g.areaTriggers.get(area);
  assert.ok(captured);
  assert.equal(captured.stats['power'], 10);
  owner.stats[STATS.id.power] = 20;
  g.step();
  g.spells.step(owner);
  assert.equal(g.spells.get(cast)?.stats['power'], 20);
  assert.equal(captured.stats['power'], 10);
  const amount = captured.scaled['power'];
  assert.ok(typeof amount === 'object');
  assert.equal(finishScaled(amount), 10);
  assert.equal(finishScaled(amount, { total: () => 100, base: () => 100 }), 20);
  const later = g.areaTriggers.spawn(g.areaId.zone, { owner, at: { x: 0, z: 0 }, cast });
  assert.equal(g.areaTriggers.get(later)?.stats['power'], 20);
  assert.equal(captured.stats['power'], 10);
});

test('reused areas discard the previous live spell stat keys', () => {
  const g = makeSpellGame(
    {
      first: {
        release: () => undefined,
        activation: { kind: 'trigger' },
        live: true,
        stats: { power: scaled(0, add('power', 1), add('maxHealth', 0.1, { from: 'target' })) },
        timeline: { windup: { seconds: 1 } }
      },
      second: {
        release: () => undefined,
        activation: { kind: 'trigger' },
        live: true,
        stats: { other: 7 },
        timeline: { windup: { seconds: 1 } }
      }
    },
    { areaTriggers: { zone: { shape: circle(1), lifetime: 2 } } }
  );

  const owner = g.unit(1);
  const first = g.spells.cast(owner, g.id.first).handle;
  const area = g.areaTriggers.spawn(g.areaId.zone, { owner, at: { x: 0, z: 0 }, cast: first });
  const snapshot = g.areaTriggers.get(area)?.scaled['power'];
  g.areaTriggers.despawn(area);
  const reused = g.areaTriggers.spawn(g.areaId.zone, { owner, at: { x: 0, z: 0 }, cast: first });
  assert.equal(g.areaTriggers.get(reused)?.scaled['power'], snapshot);
  assert.equal(g.areaTriggers.pool.created, 1);
  g.areaTriggers.despawn(reused);
  const second = g.spells.cast(owner, g.id.second).handle;
  const next = g.areaTriggers.spawn(g.areaId.zone, { owner, at: { x: 0, z: 0 }, cast: second });
  assert.deepEqual(Object.keys(g.areaTriggers.get(next)?.stats ?? {}), ['other']);
  assert.deepEqual(Object.keys(g.areaTriggers.get(next)?.scaled ?? {}), ['other']);
});

test('areas capture stats returned by live functions as well as tables', () => {
  const g = makeSpellGame(
    {
      shot: {
        activation: { kind: 'trigger' },
        live: true,
        stats: (ctx) => ({ power: ctx.view?.total(STATS.id.power) ?? 0 }),
        timeline: { windup: { seconds: 1 } },
        release: () => undefined
      }
    },
    { areaTriggers: { zone: { shape: circle(1), lifetime: 2 } } }
  );

  const owner = g.unit(1);
  const cast = g.spells.cast(owner, g.id.shot).handle;
  const area = g.areaTriggers.spawn(g.areaId.zone, { owner, at: { x: 0, z: 0 }, cast });
  owner.stats[STATS.id.power] = 20;
  g.step();
  g.spells.step(owner);
  assert.equal(g.spells.get(cast)?.stats['power'], 20);
  assert.equal(g.areaTriggers.get(area)?.stats['power'], 10);
});
