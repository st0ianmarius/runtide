import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cancelTimer, defineTimers, setTimer } from '../../src/ai/index.ts';
import type { TimerId } from '../../src/ai/index.ts';
import type { Unit } from '../../src/units/index.ts';
import { auraId, makeUnitGame, TIMERS, type UnitGame } from '../helpers/unit-game.ts';

/** A game with two grunts and a log of fired timers, stepped a tick at a time. */
const timed = () => {
  const game = makeUnitGame({ grunt: {} });
  const [a, b] = [game.units.spawn(game.id.grunt, { side: 1 }), game.units.spawn(game.id.grunt, { side: 1 })];
  const fired: string[] = [];

  const fire = (unit: Unit<UnitGame>, timer: TimerId): void => {
    fired.push(`${TIMERS.names[timer] ?? '?'}@${unit.id}@${game.clock.tick}`);
  };

  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      game.clock.step();
      game.ai.step(fire);
    }
  };

  return { ...game, a, b, fired, tick, fire };
};

describe('named timers (EventMap)', () => {
  it('fire once when due, in the order they were started within a tick, and may be started again', () => {
    const { ai, a, b, fired, tick } = timed();
    const { pick, raise } = TIMERS.id;

    ai.start(b, raise, 0.5);
    ai.start(a, pick, 0.5);
    ai.start(a, raise, 1);
    tick(2);
    assert.deepEqual(fired, ['raise@2@2', 'pick@1@2']);
    assert.equal(ai.remaining(a, pick), undefined);
    assert.equal(ai.remaining(a, raise), 0.5);
    ai.start(a, raise, 0.25);
    tick(4);
    assert.deepEqual(fired, ['raise@2@2', 'pick@1@2', 'raise@1@3']);
  });

  it('are cancelled and restarted, a restart replacing the running one', () => {
    const { ai, a, fired, tick } = timed();

    ai.start(a, TIMERS.id.pick, 0.25);
    ai.start(a, TIMERS.id.pick, 1);
    assert.equal(ai.cancel(a, TIMERS.id.raise), false);
    tick(2);
    assert.deepEqual(fired, []);
    assert.equal(ai.cancel(a, TIMERS.id.pick), true);
    tick(4);
    assert.deepEqual(fired, []);
  });

  it('are held for the game’s reasons, a unit state’s interrupt among them, counting on from what they had left', () => {
    const { ai, auras, a, fired, tick } = timed();

    ai.start(a, TIMERS.id.pick, 1);
    tick();
    assert.equal(ai.hold(a, 'intro', true), true);
    assert.equal(ai.remaining(a, TIMERS.id.pick), 0.75);
    tick(8);
    assert.deepEqual(fired, []);
    auras.apply(a, auraId('freeze'));
    assert.equal(ai.hold(a, 'intro', false), true);
    ai.start(a, TIMERS.id.raise, 0.25);
    tick(4);
    auras.remove(a, auraId('freeze'));
    assert.equal(ai.remaining(a, TIMERS.id.pick), 0.75);
    tick(1);
    assert.deepEqual(fired, ['raise@1@14']);
    tick(2);
    assert.deepEqual(fired, ['raise@1@14', 'pick@1@16']);
    assert.equal(ai.hold(a, 'stun', true), false);
  });

  it('stop with a despawned unit, whose brain the next unit reuses', () => {
    const { ai, units, id, a, fired, tick } = timed();

    ai.start(a, TIMERS.id.pick, 0.25);
    units.despawn(a);
    assert.equal(ai.release(a), false);

    const c = units.spawn(id.grunt, { side: 1 });

    assert.equal(ai.brains.created, 2);
    assert.equal(ai.remaining(c, TIMERS.id.pick), undefined);
    tick(2);
    assert.deepEqual(fired, []);
  });

  it('are the setTimer and cancelTimer procs, by name', () => {
    const { procs, ai, a } = timed();

    assert.equal(procs.apply(setTimer<UnitGame>('raise', 2), { self: a }).status, 'landed');
    assert.equal(ai.remaining(a, TIMERS.id.raise), 2);
    assert.equal(procs.apply(cancelTimer<UnitGame>('raise'), { self: a }).status, 'landed');
    assert.equal(procs.apply(cancelTimer<UnitGame>('raise'), { self: a }).status, 'skipped');
    assert.throws(() => procs.prepare([setTimer<UnitGame>('raise', -1)], 'Test'), /from 0/);

    const forged = setTimer<UnitGame>('raise', 1);

    Reflect.set(forged, 'timer', 'nap');
    assert.throws(() => procs.prepare([forged], 'Test'), /unknown timer nap/);
  });

  it('refuse bad tables and seconds', () => {
    const { ai, a } = timed();

    assert.throws(() => defineTimers(['a', 'a']), /distinct/);
    assert.throws(() => defineTimers(Array.from({ length: 33 }, (_unused, i) => `t${i}`)), /At most 32/);
    assert.throws(() => {
      ai.start(a, TIMERS.id.pick, Number.NaN);
    }, /finite number of seconds/);
    assert.throws(() => {
      ai.start(a, defineTimers(['a', 'b', 'c']).id.c, 1);
    }, /Timer 2/);
  });
});
