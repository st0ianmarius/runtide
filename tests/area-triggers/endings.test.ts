import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AnyAreaTriggerDef, type EndReason, NO_AREA_TRIGGER, spawn } from '../../src/area-triggers/index.ts';
import { circle, covers, lane, vec2 } from '../../src/math/index.ts';
import { run } from '../../src/procs/index.ts';
import { aura, CUES, type Game, makeSpellGame, mark } from '../helpers/spell-game.ts';

/** A kind that logs its end hooks, as `expire`, `end expired`; a second of lifetime by default. */
const ending = (def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
  shape: circle(1),
  lifetime: 1,

  onExpire: (c) => {
    c.host.log.push('expire');

    return undefined;
  },

  onEnd: (c, reason) => {
    c.host.log.push(`end ${reason}`);

    return undefined;
  },

  ...def,
});

/** The lines a game logged, without the spawn lines. */
const linesOf = (log: readonly string[]): string[] => log.filter((line) => !line.startsWith('spawned'));

describe('ending', () => {
  it('expires with onExpire, then onEnd, then the end event', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: ending({ lifetime: 0.25 }) } });

    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
    game.step();
    game.areaTriggers.step();
    assert.deepEqual(linesOf(game.log), ['expire', 'end expired', 'ended pool@1 expired']);
  });

  it('ends itself from its frame once the frame’s procs ran, as self or spent', () => {
    const reasons: EndReason[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          blade: ending({
            lifetime: 'spent',

            frame: (c) => {
              c.despawn(c.id === 1 ? 'self' : 'spent');
              c.despawn('self');

              return [mark('last')];
            },

            onEnd: (_c, reason) => {
              reasons.push(reason);

              return undefined;
            },
          }),
        },
      },
    );

    const owner = game.unit(1);

    game.areaTriggers.spawn(game.areaId.blade, { owner, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.blade, { owner, at: vec2(0, 0) });
    game.step();
    game.areaTriggers.step();
    assert.deepEqual(reasons, ['self', 'spent']);
    assert.equal(game.log.filter((line) => line === 'last@1').length, 2);
  });

  it('ends from outside with a reason, once; a stale handle then does nothing', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: ending() } });
    const handle = game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });

    assert.equal(game.areaTriggers.despawn(handle, 'bound'), true);
    assert.equal(game.areaTriggers.despawn(handle), false);
    assert.equal(game.areaTriggers.get(handle), undefined);
    assert.deepEqual(linesOf(game.log), ['end bound', 'ended pool@1 bound']);
  });
});

describe('bounds', () => {
  /** A game whose host says who is present, and a bound made over who is down. */
  const boundGame = (
    boundOf: (down: ReadonlySet<number>) => AnyAreaTriggerDef<Game>['bound'],
    lifetime: AnyAreaTriggerDef<Game>['lifetime'] = 5,
  ) => {
    const gone = new Set<number>();
    const down = new Set<number>();
    const bound = boundOf(down);

    const game = makeSpellGame(
      {},
      {
        host: { isPresent: (unit) => !gone.has(unit.id) },
        areaTriggers: { ward: ending({ lifetime, ...(bound === undefined ? {} : { bound }) }) },
      },
    );

    const owner = game.unit(1);
    const handle = game.areaTriggers.spawn(game.areaId.ward, { owner, at: vec2(0, 0) });

    const tick = () => {
      game.step();
      game.areaTriggers.step();
    };

    return { game, gone, down, handle, tick };
  };

  it('ends as source-gone when its owner leaves the world', () => {
    const { game, gone, tick } = boundGame(() => ({ owner: 'present' }));

    tick();
    gone.add(1);
    tick();
    assert.deepEqual(linesOf(game.log), ['end source-gone', 'ended ward@1 source-gone']);
  });

  it('ends as bound when its when fails (its owner went down)', () => {
    const { game, down, tick } = boundGame((isDown) => ({ when: (c) => !isDown.has(c.owner.id) }));

    down.add(1);
    tick();
    assert.deepEqual(linesOf(game.log), ['end bound', 'ended ward@1 bound']);
  });

  it('waits while its suspendWhile holds (its owner down), its clock and frames held, then runs on', () => {
    const { game, down, handle, tick } = boundGame((isDown) => ({ suspendWhile: (c) => isDown.has(c.owner.id) }));

    tick();
    down.add(1);
    tick();
    tick();
    assert.equal(game.areaTriggers.get(handle)?.isSuspended, true);
    assert.equal(game.areaTriggers.get(handle)?.age, 0.25);
    assert.equal(game.areaTriggers.get(handle)?.remaining, 4.75);
    down.delete(1);
    tick();
    assert.equal(game.areaTriggers.get(handle)?.isSuspended, false);
    assert.equal(game.areaTriggers.get(handle)?.age, 0.5);
  });

  it('ends as bound when its condition fails, and lives while its owner is present with a lifetime of owner', () => {
    let isOwned = true;
    const conditioned = boundGame(() => ({ when: () => isOwned }));

    conditioned.tick();
    isOwned = false;
    conditioned.tick();
    assert.deepEqual(linesOf(conditioned.game.log), ['end bound', 'ended ward@1 bound']);

    const owned = boundGame(() => undefined, 'owner');

    owned.tick();
    assert.equal(owned.game.areaTriggers.isLive(owned.handle), true);
    owned.gone.add(1);
    owned.tick();
    assert.deepEqual(linesOf(owned.game.log), ['end source-gone', 'ended ward@1 source-gone']);
  });
});

describe('limits', () => {
  /** A game with a pool limited per owner under a replace rule. */
  const limitGame = (replace: 'oldest' | 'refuse', quietOn?: 'replaced') =>
    makeSpellGame(
      {},
      {
        areaTriggers: {
          pool: ending({
            limit: { perOwner: (c) => c.rank + 1, replace },
            cues: { end: (_c, reason) => (reason === quietOn ? undefined : { cue: CUES.id.flash }) },
          }),
        },
      },
    );

  it('ends the owner’s oldest as replaced, firing its end cue, and counts per owner', () => {
    const game = limitGame('oldest');
    const [one, two] = [game.unit(1), game.unit(2)];
    const first = game.areaTriggers.spawn(game.areaId.pool, { owner: one, at: vec2(0, 0) });

    game.areaTriggers.spawn(game.areaId.pool, { owner: two, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.pool, { owner: one, at: vec2(0, 0) });
    assert.equal(game.cues.count, 0);
    game.areaTriggers.spawn(game.areaId.pool, { owner: one, at: vec2(0, 0) });
    assert.equal(game.areaTriggers.isLive(first), false);
    assert.equal(game.areaTriggers.countOf(one, game.areaId.pool), 2);
    assert.equal(game.areaTriggers.countOf(two, game.areaId.pool), 1);
    assert.equal(game.cues.count, 1);
    assert.deepEqual(linesOf(game.log), ['end replaced', 'ended pool@1 replaced']);
  });

  it('replaces silently when its end cue answers none for the reason, or refuses the new one', () => {
    const silent = limitGame('oldest', 'replaced');
    const owner = silent.unit(1);

    for (let i = 0; i < 3; i++) {
      silent.areaTriggers.spawn(silent.areaId.pool, { owner, at: vec2(0, 0) });
    }

    assert.equal(silent.cues.count, 0);

    const refusing = limitGame('refuse');
    const refused = refusing.unit(1);

    refusing.areaTriggers.spawn(refusing.areaId.pool, { owner: refused, at: vec2(0, 0) });
    refusing.areaTriggers.spawn(refusing.areaId.pool, { owner: refused, at: vec2(0, 0) });
    assert.equal(
      refusing.areaTriggers.spawn(refusing.areaId.pool, { owner: refused, at: vec2(0, 0) }),
      NO_AREA_TRIGGER,
    );
    assert.equal(refusing.areaTriggers.pool.live, 2);
  });
});

describe('place and shape', () => {
  it('places its shape at its position, turned to its heading', () => {
    const game = makeSpellGame(
      {},
      { areaTriggers: { wave: ending({ shape: lane({ length: 4, width: 2, dir: 0 }) }) } },
    );

    const handle = game.areaTriggers.spawn(game.areaId.wave, {
      owner: game.unit(1),
      at: vec2(10, 10),
      heading: Math.PI / 2,
    });

    const shape = game.areaTriggers.get(handle)?.shape;

    assert.ok(shape !== undefined);
    assert.equal(covers(shape, vec2(13, 10)), true);
    assert.equal(covers(shape, vec2(10, 13)), false);
  });

  it('moves by its own hook, re-placing its shape, and sits on its owner when anchored', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          missile: ending({
            move: (c, dt) => {
              c.position.x += 8 * dt;
            },
          }),
          aura: ending({ anchor: 'owner' }),
        },
      },
    );

    const owner = game.unit(1);
    const missile = game.areaTriggers.spawn(game.areaId.missile, { owner, at: vec2(0, 0) });
    const anchored = game.areaTriggers.spawn(game.areaId.aura, { owner, at: vec2(50, 50) });

    assert.deepEqual({ ...game.areaTriggers.get(anchored)?.position }, { x: 1, z: 0 });
    game.place(owner, vec2(5, 5));
    game.step();
    game.areaTriggers.step();
    assert.deepEqual({ ...game.areaTriggers.get(missile)?.previous }, { x: 0, z: 0 });
    assert.deepEqual({ ...game.areaTriggers.get(missile)?.position }, { x: 2, z: 0 });
    assert.equal(covers(game.areaTriggers.get(missile)?.shape ?? circle(0), vec2(2.5, 0)), true);
    assert.deepEqual({ ...game.areaTriggers.get(anchored)?.position }, { x: 5, z: 5 });
  });
});

describe('the owner aura, cues and events', () => {
  it('holds its kind’s owner aura while any instance lives', () => {
    const game = makeSpellGame(
      {},
      {
        auras: { tending: aura({ duration: 'infinite' }) },
        areaTriggers: { grove: ending({ ownerAura: 'tending' }) },
      },
    );

    const owner = game.unit(1);
    const a = game.areaTriggers.spawn(game.areaId.grove, { owner, at: vec2(0, 0) });
    const b = game.areaTriggers.spawn(game.areaId.grove, { owner, at: vec2(0, 0) });

    assert.equal(game.auras.has(owner, game.auraId.tending), true);
    game.areaTriggers.despawn(a);
    assert.equal(game.auras.has(owner, game.auraId.tending), true);
    game.areaTriggers.despawn(b);
    assert.equal(game.auras.has(owner, game.auraId.tending), false);
  });

  it('refuses an owner aura that is not infinite, at load', () => {
    assert.throws(
      () =>
        makeSpellGame(
          {},
          {
            auras: { short: aura({ duration: 2 }) },
            areaTriggers: { grove: ending({ ownerAura: 'short' }) },
          },
        ),
      /its owner aura lasts while the kind lives/,
    );
  });

  it('fires its cues at its position with its entity id, credited to its owner', () => {
    const game = makeSpellGame(
      {},
      { areaTriggers: { pool: ending({ lifetime: 0.25, cues: { spawn: () => ({ cue: CUES.id.zone }) } }) } },
    );

    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(3), at: vec2(4, 5) });
    assert.equal(game.cues.count, 1);
    assert.deepEqual(
      { ...game.cues.events[0], params: undefined },
      { ...game.cues.events[0], owner: 3, entity: 1, x: 4, z: 5, params: undefined },
    );
  });

  it('lets an aura’s trigger answer an area trigger event, filtered by kind and reason', () => {
    const game = makeSpellGame(
      {},
      {
        auras: {
          eye: aura({
            duration: 'infinite',
            triggers: [
              {
                on: 'areaEnded',
                when: [
                  { filter: 'kind', arg: 'tempest' },
                  { filter: 'reason', arg: 'expired' },
                ],
                do: [mark('chain')],
              },
            ],
          }),
        },
        areaTriggers: { tempest: ending({ lifetime: 0.25 }), pool: ending({ lifetime: 0.25 }) },
      },
    );

    const owner = game.unit(1);

    game.auras.apply(owner, game.auraId.eye);
    game.areaTriggers.spawn(game.areaId.tempest, { owner, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0) });
    game.areaTriggers.despawn(game.areaTriggers.spawn(game.areaId.tempest, { owner, at: vec2(0, 0) }));
    game.step();
    game.areaTriggers.step();
    assert.equal(game.log.filter((line) => line === 'chain@1').length, 1);
  });
});

describe('procs and keys', () => {
  it('runs its hooks’ procs as its owner’s, credited to its source, its cast current', () => {
    const seen: string[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          pool: ending({
            frame: (c) => [
              run<Game>('look', (ctx) => {
                seen.push(`${ctx.self.id} ${ctx.source} ${c.apply(mark('applied')).status}`);
              }),
            ],
          }),
        },
      },
    );

    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(2), at: vec2(0, 0), source: 9 });
    game.step();
    game.areaTriggers.step();
    assert.deepEqual(seen, ['2 9 landed']);
    assert.ok(game.log.includes('applied@2'));
  });

  it('keys its rolls by spawn tick, entity id, kind, target and index', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: ending() } });

    game.step(3);

    const handle = game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });

    assert.deepEqual(game.areaTriggers.get(handle)?.key(7, 2), [3, 1, 0, 7, 2]);
  });

  it('spawns from a proc at a point or on a unit, and reports a refusal', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: ending({ limit: { perOwner: 1, replace: 'refuse' } }) } });

    const [owner, other] = [game.unit(1), game.unit(4)];

    assert.equal(game.procs.apply(spawn<Game>('pool', { to: other }), { self: owner }).status, 'landed');
    assert.equal(game.procs.apply(spawn<Game>('pool', { at: vec2(1, 1) }), { self: owner }).status, 'refused');
    assert.throws(() => game.procs.prepare([spawn<Game>('nothing')], 'Test list'), /unknown area trigger kind nothing/);
    assert.deepEqual(
      game.areaTriggers.get(game.areaTriggers.spawn(game.areaId.pool, { owner: other, at: vec2(0, 0) }))?.position,
      { x: 0, z: 0 },
    );
  });

  it('reuses its records: a steady stream of spawns and ends makes no new ones', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: ending({ lifetime: 0.25 }) } });
    const owner = game.unit(1);

    for (let i = 0; i < 5; i++) {
      game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0) });
      game.step();
      game.areaTriggers.step();
    }

    const { created } = game.areaTriggers.pool;

    for (let i = 0; i < 50; i++) {
      game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0) });
      game.step();
      game.areaTriggers.step();
    }

    assert.equal(game.areaTriggers.pool.created, created);
    assert.equal(game.areaTriggers.pool.live, 0);
  });
});
