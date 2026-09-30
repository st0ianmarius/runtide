import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Vec2 } from '../../src/math/index.ts';
import { createMemoryWorld } from '../../src/world/index.ts';
import { makeSpellGame, mark, spell, type Unit } from '../helpers/spell-game.ts';

/** A world with a pillar of radius 1 at (5, 0), between units 1 and 9. */
const pillared = () =>
  createMemoryWorld<Unit>({
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    statics: [{ kind: 'circle', at: { x: 5, z: 0 }, r: 1 }]
  });

/** Aims at the unit it was handed. */
const atInput = (_ctx: unknown, input: Unit | undefined): Unit | undefined => input;

/** Whether a value is a test unit. */
const isUnit = (value: unknown): value is Unit => typeof value === 'object' && value !== null && 'casts' in value;

/** A unit's point. */
const pointOfUnit = (target: Unit): Vec2 => target.at;

describe('reach rules', () => {
  it('refuse a target past the range, after the target is picked, and read the range from the cast', () => {
    const game = makeSpellGame({
      poke: spell({
        activation: { kind: 'trigger' },
        target: atInput,
        reach: { range: 4, pointOf: pointOfUnit },
        release: () => [mark('poke')]
      }),
      far: spell({
        activation: { kind: 'trigger' },
        stats: { reach: 8 },
        target: atInput,
        reach: { range: (ctx) => ctx.stats.reach, pointOf: pointOfUnit },
        release: () => [mark('far')]
      })
    });

    const [hero, near, away] = [game.unit(1), game.unit(5), game.unit(9)];

    assert.equal(game.spells.cast(hero, game.id.poke, { input: near }).status, 'ended');
    assert.equal(game.spells.cast(hero, game.id.poke, { input: away }).refusal, 'range');
    assert.equal(game.spells.cast(hero, game.id.far, { input: away }).status, 'ended');
    assert.equal(game.spells.cast(hero, game.id.poke, {}).refusal, 'target');
    assert.deepEqual(
      game.log.filter((line) => !line.includes(' ')),
      ['poke@1', 'far@1']
    );
  });

  it('refuse a target nearer than the least range, then ask the game’s own rule over the picked target', () => {
    const game = makeSpellGame({
      charge: spell({
        activation: { kind: 'trigger' },
        target: atInput,
        reach: {
          range: 10,
          minRange: 3,
          pointOf: pointOfUnit,
          allows: (_ctx, target) => (target?.id ?? 0) !== 9
        },
        release: () => [mark('charge')]
      })
    });

    const [hero, close, mid, barred] = [game.unit(1), game.unit(2), game.unit(5), game.unit(9)];

    assert.equal(game.spells.cast(hero, game.id.charge, { input: close }).refusal, 'close');
    assert.equal(game.spells.cast(hero, game.id.charge, { input: barred }).refusal, 'reach');
    assert.equal(game.spells.cast(hero, game.id.charge, { input: mid }).status, 'ended');
    assert.equal(game.spells.check(hero, game.id.charge, { input: close }), 'close');
  });

  it('refuse a target out of sight, through the system’s world', () => {
    const game = makeSpellGame(
      {
        glare: spell({
          activation: { kind: 'trigger' },
          target: atInput,
          reach: { sight: true, pointOf: pointOfUnit },
          release: () => [mark('glare')]
        })
      },
      { spells: { world: pillared() } }
    );

    const hero = game.unit(1);

    assert.equal(game.spells.cast(hero, game.id.glare, { input: game.unit(9) }).refusal, 'sight');
    assert.equal(game.spells.cast(hero, game.id.glare, { input: game.unit(3) }).status, 'ended');
  });

  it('take the host’s point of a target', () => {
    const game = makeSpellGame(
      {
        bite: spell({
          activation: { kind: 'trigger' },
          target: atInput,
          reach: { range: 2, sight: true },
          release: () => [mark('bite')]
        })
      },
      {
        spells: { world: pillared() },
        host: { pointOf: (target) => (isUnit(target) ? target.at : undefined) }
      }
    );

    const beast = game.unit(1);

    assert.equal(game.spells.cast(beast, game.id.bite, { input: game.unit(2) }).status, 'ended');
    assert.equal(game.spells.cast(beast, game.id.bite, { input: game.unit(4) }).refusal, 'range');
  });

  it('are asked without casting by spells.check, which starts nothing', () => {
    const game = makeSpellGame({
      poke: spell({
        activation: { kind: 'trigger' },
        target: atInput,
        reach: { range: 4, pointOf: pointOfUnit },
        release: () => [mark('poke')]
      })
    });

    const hero = game.unit(1);

    assert.equal(game.spells.check(hero, game.id.poke, { input: game.unit(9) }), 'range');
    assert.equal(game.spells.check(hero, game.id.poke, { input: game.unit(2) }), undefined);
    assert.equal(game.spells.isCasting(hero), false);
    assert.deepEqual(game.log, []);
    assert.equal(game.spells.pool.live, 0);
  });

  it('cost an auto clock its retry, so a swing polls its reach every step', () => {
    const aim: { target?: Unit } = {};

    const game = makeSpellGame({
      swing: spell({
        activation: { kind: 'auto', interval: 2 },
        target: () => aim.target,
        reach: { range: 1.5, pointOf: pointOfUnit },
        release: () => [mark('swing')]
      })
    });

    const hero = game.unit(1);

    const target = game.unit(5);

    aim.target = target;
    game.spells.stepAuto(hero);
    assert.equal(game.spells.autoClock(hero, game.id.swing), 0);
    game.place(target, { x: 2, z: 0 });
    game.spells.stepAuto(hero);
    assert.equal(game.spells.autoClock(hero, game.id.swing), 2);
    assert.deepEqual(
      game.log.filter((line) => !line.includes(' ')),
      ['swing@1']
    );
  });

  it('are checked at load: a reach needs a target hook, a sound range and room, and a world', () => {
    const release = () => undefined;

    assert.throws(
      () =>
        makeSpellGame({
          x: spell({ activation: { kind: 'trigger' }, reach: { range: 1 }, release })
        }),
      /its reach is checked against its target/
    );
    assert.throws(
      () =>
        makeSpellGame({
          x: spell({
            activation: { kind: 'trigger' },
            target: atInput,
            reach: { range: -1 },
            release
          })
        }),
      /its range takes a distance from 0/
    );
    assert.throws(
      () =>
        makeSpellGame({
          x: spell({
            activation: { kind: 'trigger' },
            target: atInput,
            reach: { sight: true },
            release
          })
        }),
      /needs a world/
    );
  });

  it('throws when no one knows the target’s point', () => {
    const game = makeSpellGame({
      poke: spell({
        activation: { kind: 'trigger' },
        target: atInput,
        reach: { range: 4 },
        release: () => undefined
      })
    });

    assert.throws(
      () => game.spells.cast(game.unit(1), game.id.poke, { input: game.unit(2) }),
      /needs its target's point/
    );
  });
});
