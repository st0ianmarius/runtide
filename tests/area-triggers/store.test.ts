import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import {
  type AnyAreaTriggerDef,
  type AreaTriggerHandle,
  type AreaTriggerSystem,
  NO_AREA_TRIGGER,
  spawn,
} from '../../src/area-triggers/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { type Game, makeSpellGame, spell, TICK_SLOTS } from '../helpers/spell-game.ts';

/** The live area triggers of a game, in kind order and creation order. */
const allOf = (game: { readonly areaTriggers: AreaTriggerSystem<Game> }) => {
  const out: AreaTriggerHandle[] = [];
  const count = game.areaTriggers.query({}, out);

  return out.slice(0, count).map((handle) => game.areaTriggers.get(handle));
};

/** A spell that spawns one area trigger of a kind at `(10, 0)` when it goes out. */
const spawner = (kind: string) =>
  spell({ activation: { kind: 'trigger' }, release: () => [spawn<Game>(kind, { at: vec2(10, 0) })] });

/** A kind that logs each frame's `dt` and age, as `frame 0.25/0.5`. */
const logged = (def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
  shape: circle(1),
  lifetime: 1,

  frame: (c, dt) => {
    c.host.log.push(`frame ${dt}/${c.age}`);

    return undefined;
  },

  ...def,
});

describe('spawning', () => {
  it('spawns from a spell’s procs, owned by the caster, credited to the cast, holding the cast alive', () => {
    const game = makeSpellGame({ nova: spawner('pool') }, { areaTriggers: { pool: logged({ lifetime: 0.5 }) } });
    const caster = game.unit(1);
    const report = game.spells.cast(caster, game.id.nova);
    const { handle } = report;
    const [area] = allOf(game);

    assert.equal(report.status, 'ended');
    assert.equal(area?.owner, caster);
    assert.equal(area?.source, 1);
    assert.equal(area?.cast?.cast, handle);
    assert.deepEqual({ ...area?.position }, { x: 10, z: 0 });
    assert.equal(game.spells.isRunning(handle), false);
    assert.notEqual(game.spells.get(handle), undefined);
    game.step();
    game.areaTriggers.step();
    game.step();
    game.areaTriggers.step();
    assert.equal(game.spells.get(handle), undefined);
    assert.deepEqual(game.log, [
      'start nova@1',
      'spawned pool@1',
      'release nova@1',
      'end nova@1 released',
      'frame 0.25/0.25',
      'frame 0.25/0.5',
      'ended pool@1 expired',
    ]);
  });

  it('allocates the entity id from the host before init, which reads the spawn’s input', () => {
    let next = 500;
    const seen: string[] = [];

    const game = makeSpellGame(
      {},
      {
        host: { allocateId: () => (next += 1) },
        areaTriggers: {
          pool: logged({
            init: (c, input) => {
              seen.push(`init ${c.id} ${input}`);
            },
          }),
        },
      },
    );

    const owner = game.unit(1);

    game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0), input: 7 });
    game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0), input: 8 });
    assert.deepEqual(seen, ['init 501 7', 'init 502 8']);
  });

  it('waits for the next tick unless it flies now, with the time it is given', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: logged() } });
    const owner = game.unit(1);

    game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0) });
    assert.equal(game.areaTriggers.step(), 0);
    game.areaTriggers.spawn(game.areaId.pool, { owner, at: vec2(0, 0), now: 0.1 });
    assert.deepEqual(game.log, ['spawned pool@1', 'spawned pool@1', 'frame 0.1/0.1']);
    game.step();
    assert.equal(game.areaTriggers.step(), 2);
  });

  it('keeps its own state per instance, a child’s apart from its parent’s', () => {
    const states: unknown[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          parent: logged({ state: () => ({ passes: 0 }), frame: () => [spawn<Game>('child')] }),
          child: logged({ state: () => ({ own: true }), init: (c) => void states.push(c.state) }),
        },
      },
    );

    const owner = game.unit(1);
    const parent = game.areaTriggers.spawn(game.areaId.parent, { owner, at: vec2(0, 0) });

    game.step();
    game.areaTriggers.step();
    assert.notEqual(states[0], game.areaTriggers.get(parent)?.state);
    assert.deepEqual(states[0], { own: true });
  });
});

describe('lifetime and expiry', () => {
  /** The frames a one-second area trigger runs over 0.9 s of lifetime, under an expiry mode. */
  const framesOf = (expiry: 'after' | 'before' | 'clip'): string[] => {
    const game = makeSpellGame({}, { areaTriggers: { pool: logged({ lifetime: 0.9, expiry }) } });

    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });

    for (let i = 0; i < 6; i++) {
      game.step();
      game.areaTriggers.step();
    }

    return game.log.filter((line) => line !== 'spawned pool@1');
  };

  it('runs the last frame whole after the lifetime ran out (after)', () => {
    assert.deepEqual(framesOf('after'), [
      'frame 0.25/0.25',
      'frame 0.25/0.5',
      'frame 0.25/0.75',
      'frame 0.25/1',
      'ended pool@1 expired',
    ]);
  });

  it('expires without the last frame (before), or runs it cut to the time left (clip)', () => {
    assert.deepEqual(framesOf('before'), [
      'frame 0.25/0.25',
      'frame 0.25/0.5',
      'frame 0.25/0.75',
      'ended pool@1 expired',
    ]);
    assert.match(framesOf('clip')[3] ?? '', /^frame 0\.15\d*\/0\.9\d*$/);
  });

  it('reads a lifetime function once, and lives forever when spent or owned until something ends it', () => {
    const game = makeSpellGame(
      {},
      { areaTriggers: { timed: logged({ lifetime: (c) => c.rank / 4 }), spent: logged({ lifetime: 'spent' }) } },
    );

    const owner = game.unit(1);
    const spent = game.areaTriggers.spawn(game.areaId.spent, { owner, at: vec2(0, 0) });

    game.areaTriggers.spawn(game.areaId.timed, { owner, at: vec2(0, 0) });
    assert.equal(game.areaTriggers.get(spent)?.remaining, Number.POSITIVE_INFINITY);
    game.step();
    game.areaTriggers.step();
    assert.equal(game.areaTriggers.isLive(spent), true);
    assert.ok(game.log.includes('ended timed@1 expired'));
  });
});

describe('the tick order', () => {
  /** Kinds that log their name as they tick; `a` spawns a `child` and a `b` on its first frame. */
  const kinds = {
    a: logged({
      lifetime: 'spent',

      frame: (c) => {
        c.host.log.push(`a${c.id}`);

        if (c.age === 0.25) {
          return [spawn<Game>('child'), spawn<Game>('b'), spawn<Game>('child')];
        }

        return c.age === 0.75 ? [spawn<Game>('child')] : undefined;
      },
    }),
    b: logged({
      lifetime: 'spent',

      frame: (c) => {
        c.host.log.push(`b${c.id}`);

        return undefined;
      },
    }),
    child: logged({
      lifetime: 'spent',

      frame: (c) => {
        c.host.log.push(`child${c.id}`);

        return undefined;
      },
    }),
    late: logged({
      lifetime: 'spent',
      tickIn: TICK_SLOTS.id.late,

      frame: (c) => {
        c.host.log.push(`late${c.id}`);

        return undefined;
      },
    }),
  };

  it('steps kind by kind in registry order, each in creation order', () => {
    const game = makeSpellGame({}, { areaTriggers: kinds });
    const owner = game.unit(1);

    game.areaTriggers.spawn(game.areaId.b, { owner, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.a, { owner, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.a, { owner, at: vec2(0, 0) });
    game.step();
    game.areaTriggers.step();
    game.log.length = 0;
    game.step();
    game.areaTriggers.step();
    assert.deepEqual(game.log, ['a2', 'a3', 'b1', 'b5', 'b8', 'child4', 'child6', 'child7', 'child9']);
  });

  it('steps an owner’s area triggers in the order the whole walk steps them, whatever owners they sit among', () => {
    const quiet = (name: string) =>
      logged({
        lifetime: 'spent',

        frame: (c) => {
          c.host.log.push(`${name}${c.id}@${c.owner.id}`);

          return undefined;
        },
      });

    const op = fc.record({
      kind: fc.constantFrom('a', 'b', 'child' as const),
      owner: fc.integer({ min: 1, max: 3 }),
      parent: fc.nat(),
      despawn: fc.option(fc.nat(), { nil: undefined }),
    });

    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 24 }), (ops) => {
        const game = makeSpellGame({}, { areaTriggers: { a: quiet('a'), b: quiet('b'), child: quiet('child') } });
        const owners = [game.unit(1), game.unit(2), game.unit(3)];
        const live: AreaTriggerHandle[] = [];

        for (const { kind, owner, parent, despawn } of ops) {
          const unit = owners[owner - 1] ?? game.unit(owner);
          const parentHandle = kind === 'child' ? live[parent % Math.max(1, live.length)] : undefined;

          live.push(
            game.areaTriggers.spawn(game.areaId[kind], {
              owner: unit,
              at: vec2(0, 0),
              ...(parentHandle === undefined ? {} : { parent: parentHandle }),
            }),
          );

          if (despawn !== undefined && live.length > 1) {
            game.areaTriggers.despawn(live.splice(despawn % live.length, 1)[0] ?? NO_AREA_TRIGGER);
          }
        }

        game.step();
        game.log.length = 0;
        game.areaTriggers.step();

        const whole = [...game.log];

        game.step();
        game.log.length = 0;

        for (const unit of owners) {
          game.areaTriggers.stepOwner(unit);
        }

        const byOwner = owners.flatMap((unit) => whole.filter((line) => line.endsWith(`@${unit.id}`)));

        assert.deepEqual(game.log, byOwner);
      }),
    );
  });

  it('steps each slot and each owner on its own', () => {
    const game = makeSpellGame({}, { areaTriggers: kinds });
    const [one, two] = [game.unit(1), game.unit(2)];
    const late = game.areaTriggers.spawn(game.areaId.late, { owner: one, at: vec2(0, 0) });

    game.areaTriggers.spawn(game.areaId.b, { owner: one, at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.b, { owner: two, at: vec2(0, 0) });
    game.step();
    game.log.length = 0;
    assert.equal(game.areaTriggers.stepOwner(two), 1);
    assert.equal(game.areaTriggers.step(TICK_SLOTS.id.late), 1);
    assert.equal(game.areaTriggers.step(), 1);
    assert.equal(game.areaTriggers.step(), 0);
    assert.deepEqual(game.log, ['b3', `late${game.areaTriggers.get(late)?.id}`, 'b2']);
  });

  it('hands an owner left with none its record back, for the next owner to start empty', () => {
    const game = makeSpellGame({}, { areaTriggers: kinds });
    const [one, two] = [game.unit(1), game.unit(2)];

    game.areaTriggers.despawn(game.areaTriggers.spawn(game.areaId.b, { owner: one, at: vec2(0, 0) }));
    game.areaTriggers.spawn(game.areaId.b, { owner: two, at: vec2(0, 0) });
    game.step();
    game.log.length = 0;
    assert.deepEqual(
      [game.areaTriggers.countOf(one, game.areaId.b), game.areaTriggers.countOf(two, game.areaId.b)],
      [0, 1],
    );
    assert.deepEqual([game.areaTriggers.stepOwner(one), game.areaTriggers.stepOwner(two)], [0, 1]);
    assert.deepEqual(game.log, ['b2']);
  });
});
