import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setTimer } from '../../src/ai/index.ts';
import { defineBehaviour, defineScripts } from '../../src/scripts/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

const behaviour = defineBehaviour<UnitGame>();

/** A game with one boss whose script starts a 0.5 s timer at spawn and again each time it fires, logging its ticks. */
const pulsing = () => {
  const fired: number[] = [];
  const restart = () => [setTimer<UnitGame>('pick', 0.5)];

  const pulse = behaviour({
    spawn: restart,

    timer: () => {
      fired.push(game.clock.tick);

      return restart();
    }
  });

  const game = makeUnitGame(
    { boss: { script: 'boss' } },
    { scripts: defineScripts<UnitGame, 'boss'>({ boss: [pulse] }) }
  );

  const boss = game.units.spawn(game.id.boss, { side: 1 });

  return { ...game, boss, fired };
};

describe('scripts step in their order', () => {
  it('fire a timer its own handler starts again every 0.5 s: collect once a tick, then each unit’s step', () => {
    const game = pulsing();

    for (let i = 0; i < 8; i++) {
      game.clock.step();
      game.scripts.collect();
      game.scripts.step(game.boss);
      game.scripts.step(game.boss);
    }

    assert.deepEqual(game.fired, [2, 4, 6, 8]);
    assert.equal(game.scripts.collect(), 0, 'a second collect on a tick gathers none');
  });

  it('refuse a unit’s step before this tick’s collect, rather than fire its timers late', () => {
    const game = pulsing();

    assert.throws(() => {
      game.scripts.step(game.boss);
    }, /scripts\.step\(unit\) on tick 0 before scripts\.collect\(\)/);
    game.scripts.collect();
    game.scripts.step(game.boss);
    game.clock.step();
    assert.throws(() => {
      game.scripts.step(game.boss);
    }, /on tick 1 before scripts\.collect\(\): each tick calls scripts\.collect\(\) once, then each unit/);

    const grunt = makeUnitGame({ grunt: {} });
    const plain = grunt.units.spawn(grunt.id.grunt, { side: 1 });

    assert.throws(
      () => {
        grunt.scripts.step(plain);
      },
      /before scripts\.collect/,
      'an unscripted unit too'
    );
  });

  it('refuse a collect on a tick ai.step took, and ai.step on a tick collect took', () => {
    const game = pulsing();
    const ticks = () => [game.ai.steppedTick, game.ai.collectedTick];

    assert.deepEqual(ticks(), [-1, -1]);
    game.clock.step();
    game.clock.step();
    assert.equal(
      game.ai.step(() => undefined),
      1,
      'ai.step hands the scripted unit’s timer to its fire'
    );
    assert.deepEqual(ticks(), [2, -1]);
    assert.throws(() => game.scripts.collect(), /scripts\.collect\(\) on tick 2, which ai\.step already took/);
    assert.throws(() => game.ai.collect(() => undefined), /ai\.collect on tick 2, which ai\.step already took/);
    assert.equal(
      game.ai.step(() => undefined),
      0,
      'a second ai.step on a tick fires nothing'
    );
    game.clock.step();
    game.scripts.collect();
    assert.deepEqual(ticks(), [2, 3]);
    assert.throws(() => game.ai.step(() => undefined), /ai\.step on tick 3, which ai\.collect \(scripts\.collect\)/);
    assert.equal(
      game.ai.collect(() => undefined),
      0,
      'a second collect on a tick gathers none'
    );
  });
});
