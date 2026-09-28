import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AnyAreaTriggerDef,
  type AreaPulse,
  type AreaTriggerHandle,
  spawn,
} from '../../src/area-triggers/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { type Game, makeSpellGame, spell } from '../helpers/spell-game.ts';

/** A pool with pulses, living long enough; its frame does nothing. */
const pool = (
  every: readonly AreaPulse<Game>[],
  def: Partial<AnyAreaTriggerDef<Game>> = {},
): AnyAreaTriggerDef<Game> => ({
  shape: circle(2),
  lifetime: 10,
  every,
  ...def,
});

/** A pulse that logs its beat as `beat <id> <age>: <unit ids>`. */
const logging = (pulse: Partial<AreaPulse<Game>> = {}): AreaPulse<Game> => ({
  seconds: 0.5,

  onPulse: (c, hit) => {
    c.host.log.push(`beat ${c.id} ${c.age}: ${hit.targets.map((unit) => unit.id).join(',')}`);

    return undefined;
  },

  ...pulse,
});

/** Steps a game's clock and its area triggers `count` times. */
const ticks = (game: ReturnType<typeof makeSpellGame>, count: number): void => {
  for (let i = 0; i < count; i++) {
    game.step();
    game.areaTriggers.step();
  }
};

/** A game's log lines that start with `beat`. */
const beats = (log: readonly string[]): string[] => log.filter((line) => line.startsWith('beat'));

describe('own pulses (§II.3.4, §II.6 W2)', () => {
  it('beats on its own clock, catching its owner’s foes in its shape', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: pool([logging()]) } });
    const owner = game.unit(1);
    const [foe, ally] = [game.unit(100), game.unit(2)];

    game.place(foe, vec2(1, 0));
    game.place(ally, vec2(-1, 0));
    game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0) });
    ticks(game, 4);
    assert.deepEqual(beats(game.log), ['beat 1 0.5: 100', 'beat 1 1: 100']);
  });

  it('catches in a shape of its own, turned with it, or catches nothing', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          wide: pool([logging({ hits: circle(1, vec2(0, 5)) })]),
          blind: pool([logging({ hits: 'none' })]),
        },
      },
    );

    const owner = game.unit(1);

    game.place(game.unit(100), vec2(5, 0));
    game.areaTriggers.spawn(game.areaId.wide, { owner, at: vec2(0, 0), heading: Math.PI / 2 });
    game.areaTriggers.spawn(game.areaId.blind, { owner, at: vec2(5, 0) });
    ticks(game, 2);
    assert.deepEqual(beats(game.log), ['beat 1 0.5: 100', 'beat 2 0.5: ']);
  });

  it('reschedules by cadence, carrying the leftover, or by restart', () => {
    const count = (reschedule: 'cadence' | 'restart'): number => {
      const game = makeSpellGame({}, { areaTriggers: { pool: pool([logging({ seconds: 0.3, reschedule })]) } });

      game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
      ticks(game, 4);

      return beats(game.log).length;
    };

    assert.equal(count('cadence'), 3);
    assert.equal(count('restart'), 2);
  });

  it('catches up on several beats in one step, unless told not to; the first beat can come at once', () => {
    const count = (pulse: Partial<AreaPulse<Game>>): number => {
      const game = makeSpellGame({}, { areaTriggers: { pool: pool([logging({ seconds: 0.1, ...pulse })]) } });

      game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
      ticks(game, 4);

      return beats(game.log).length;
    };

    assert.equal(count({}), 10);
    assert.equal(count({ catchUp: false }), 4);
    assert.equal(count({ seconds: 2, first: 0 }), 1);
  });

  it('reads its seconds from the area trigger at every reschedule', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: pool([logging({ seconds: (c) => c.age + 0.25 })]) } });

    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 8);
    assert.deepEqual(
      beats(game.log).map((line) => line.split(':')[0]),
      ['beat 1 0.25', 'beat 1 0.75', 'beat 1 1.75'],
    );
  });
});

describe('shared clocks (§II.6 W2)', () => {
  it('beats every member of an owner’s clock at once, from the first to step, each owner on its own', () => {
    const game = makeSpellGame({}, { areaTriggers: { patch: pool([logging({ clock: 'owner-shared' })]) } });
    const [one, two] = [game.unit(1), game.unit(2)];

    game.areaTriggers.spawn(game.areaId.patch, { owner: one, at: vec2(0, 0) });
    ticks(game, 1);
    game.areaTriggers.spawn(game.areaId.patch, { owner: one, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.patch, { owner: two, at: vec2(0, 0) });
    ticks(game, 1);
    assert.deepEqual(beats(game.log), ['beat 1 0.5: ', 'beat 2 0: ']);
    ticks(game, 1);
    assert.deepEqual(beats(game.log).slice(2), ['beat 3 0.5: ']);
  });

  it('shares one clock between every owner on a global clock', () => {
    const game = makeSpellGame({}, { areaTriggers: { patch: pool([logging({ clock: 'global' })]) } });

    game.areaTriggers.spawn(game.areaId.patch, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1);
    game.areaTriggers.spawn(game.areaId.patch, { owner: game.unit(2), at: vec2(0, 0) });
    ticks(game, 1);
    assert.deepEqual(beats(game.log), ['beat 1 0.5: ', 'beat 2 0: ']);
  });

  it('starts again with the next member once empty, or keeps its time when it survives', () => {
    const beatsOf = (whenEmpty: 'reset' | 'survive'): string[] => {
      const game = makeSpellGame(
        {},
        { areaTriggers: { patch: pool([logging({ clock: 'owner-shared', whenEmpty })]) } },
      );

      const owner = game.unit(1);
      const first = game.areaTriggers.spawn(game.areaId.patch, { owner, at: vec2(0, 0) });

      ticks(game, 1);
      game.areaTriggers.despawn(first);
      game.areaTriggers.spawn(game.areaId.patch, { owner, at: vec2(0, 0) });
      ticks(game, 2);

      return beats(game.log);
    };

    assert.deepEqual(beatsOf('reset'), ['beat 2 0.5: ']);
    assert.deepEqual(beatsOf('survive'), ['beat 2 0.25: ']);
  });

  it('gives a unit several members caught on one beat only to the hottest, the first on ties', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          patch: pool([logging({ clock: 'owner-shared', pick: 'hottest', heat: (c) => c.input ?? 0 })]),
        },
      },
    );

    const owner = game.unit(1);

    game.place(game.unit(100), vec2(0, 0));
    game.place(game.unit(101), vec2(3, 0));
    game.areaTriggers.spawn(game.areaId.patch, { owner, at: vec2(0, 0), input: 1 });
    game.areaTriggers.spawn(game.areaId.patch, { owner, at: vec2(1, 0), input: 5 });
    game.areaTriggers.spawn(game.areaId.patch, { owner, at: vec2(-1, 0), input: 5 });
    ticks(game, 2);
    assert.deepEqual(beats(game.log), ['beat 1 0.5: ', 'beat 2 0.25: 100,101', 'beat 3 0.25: ']);
  });
});

describe('arming and the frame’s order (§II.6 W2)', () => {
  it('holds its frame while arming, then runs it with the time left over on the tick it arms', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          sentry: pool([], {
            arming: 0.3,

            frame: (c, dt) => {
              c.host.log.push(`frame ${dt.toFixed(2)}`);

              return undefined;
            },
          }),
        },
      },
    );

    game.areaTriggers.spawn(game.areaId.sentry, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 3);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('frame')),
      ['frame 0.20', 'frame 0.25'],
    );
  });

  it('runs its parts in its declared order', () => {
    const phases = (order?: AnyAreaTriggerDef<Game>['order']): string[] => {
      const game = makeSpellGame(
        {},
        {
          areaTriggers: {
            wave: pool([logging({ seconds: 0.25 })], {
              ...(order === undefined ? {} : { order }),
              move: (c) => void c.host.log.push('move'),
              frame: (c) => void c.host.log.push('frame'),
            }),
          },
        },
      );

      game.areaTriggers.spawn(game.areaId.wave, { owner: game.unit(1), at: vec2(0, 0) });
      ticks(game, 1);

      return game.log.filter((line) => !line.startsWith('spawned')).map((line) => line.split(' ')[0] ?? '');
    };

    assert.deepEqual(phases(), ['move', 'frame', 'beat']);
    assert.deepEqual(phases(['pulses', 'frame', 'move']), ['beat', 'frame', 'move']);
  });
});

describe('contacts and landings (§II.3.4)', () => {
  /** A missile flying along +x at 8 m/s, sweeping a body of 0.5 m. */
  const missile = (def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
    shape: circle(0.5),
    lifetime: 2,
    contact: { radius: 0.5 },

    move: (c, dt) => {
      c.position.x += 8 * dt;
    },

    onContact: (c, hit) => {
      c.host.log.push(`contact ${c.age}: ${hit.targets.map((unit) => unit.id).join(',')}`);

      return undefined;
    },

    ...def,
  });

  it('hands its sweep’s foes to onContact in the order it reached them', () => {
    const game = makeSpellGame({}, { areaTriggers: { missile: missile() } });
    const [near, far, ally] = [game.unit(100), game.unit(101), game.unit(2)];

    game.place(near, vec2(3, 0.5));
    game.place(far, vec2(3.5, 0));
    game.place(ally, vec2(1, 0));
    game.world.tick();
    game.areaTriggers.spawn(game.areaId.missile, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 2);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('contact')),
      ['contact 0.5: 100,101'],
    );
  });

  it('reaches only its locked unit while locked, and what its filter lets through', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          homing: missile(),
          picky: missile({ contact: { radius: 0.5, unitFilter: (_c, unit) => unit.id !== 100 } }),
        },
      },
    );

    const [a, b] = [game.unit(100), game.unit(101)];

    game.place(a, vec2(1, 0));
    game.place(b, vec2(1.5, 0));

    const homing = game.areaTriggers.spawn(game.areaId.homing, { owner: game.unit(1), at: vec2(0, 0) });

    game.areaTriggers.get(homing)?.lock(b);
    game.areaTriggers.spawn(game.areaId.picky, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('contact')),
      ['contact 0.25: 101', 'contact 0.25: 101'],
    );
  });

  it('lands as it expires, handing the foes in its shape to onLand and to its cast', () => {
    const game = makeSpellGame(
      {
        slam: spell({
          activation: { kind: 'trigger' },
          release: () => [spawn<Game>('telegraph', { at: vec2(20, 0) })],

          onHit: (ctx, hit) => {
            ctx.host.log.push(`onHit ${hit.targets.length}`);

            return undefined;
          },
        }),
      },
      {
        areaTriggers: {
          telegraph: {
            shape: circle(2),
            lifetime: 0.5,
            hitsCast: true,

            onLand: (c, hit) => {
              c.host.log.push(`land ${hit.targets.map((unit) => unit.id).join(',')}`);

              return undefined;
            },
          },
        },
      },
    );

    game.place(game.unit(100), vec2(21, 0));
    game.spells.cast(game.unit(1), game.id.slam);
    ticks(game, 2);
    assert.deepEqual(game.log.slice(-4), ['land 100', 'onHit 1', 'hit slam@1', 'ended telegraph@1 expired']);
  });
});

describe('an area trigger that casts (§II.3.4: the sentry)', () => {
  it('casts its spell as its owner on its own clock, what the cast spawns its child', () => {
    const children: AreaTriggerHandle[] = [];

    const game = makeSpellGame(
      {
        bolt: spell({
          activation: { kind: 'trigger' },

          release: (ctx) => {
            ctx.host.log.push(`bolt by ${ctx.caster.id} for ${ctx.source} at ${ctx.input?.id ?? 'nothing'}`);

            return [spawn<Game>('spark')];
          },
        }),
      },
      {
        areaTriggers: {
          sentry: pool([], { caster: { spell: 'bolt', seconds: 0.5, input: () => undefined } }),
          spark: { shape: circle(1), lifetime: 5, init: (c) => void children.push(c.parent) },
        },
      },
    );

    const sentry = game.areaTriggers.spawn(game.areaId.sentry, { owner: game.unit(1), at: vec2(0, 0), source: 7 });

    ticks(game, 4);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('bolt')),
      ['bolt by 1 for 7 at nothing', 'bolt by 1 for 7 at nothing'],
    );
    assert.deepEqual(children, [sentry, sentry]);
  });

  it('refuses a spell the game does not have, at load', () => {
    assert.throws(
      () => makeSpellGame({}, { areaTriggers: { sentry: pool([], { caster: { spell: 'nothing', seconds: 1 } }) } }),
      /it casts nothing, which is not a live spell/,
    );
  });
});
