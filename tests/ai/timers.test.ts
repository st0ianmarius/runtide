import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cancelTimer, createAiSystem, DEAD_HOLD, defineTimers, setTimer } from '../../src/ai/index.ts';
import type { TimerId } from '../../src/ai/index.ts';
import { toId } from '../../src/core/ids.ts';
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

  it('ignore a start, a hold or a focus on a freed brain, so the next unit given it inherits nothing', () => {
    const { ai, units, id, a, fired, tick } = timed();

    units.despawn(a);
    ai.start(a, TIMERS.id.pick, 0.25);
    ai.setFocus(a, 7);
    assert.equal(ai.hold(a, 'intro', true), false);
    assert.equal(ai.cancel(a, TIMERS.id.pick), false);

    const c = units.spawn(id.grunt, { side: 1 });

    assert.deepEqual([ai.remaining(c, TIMERS.id.pick), ai.focusOf(c)], [undefined, -1]);
    ai.start(c, TIMERS.id.pick, 0.125);
    tick(2);
    assert.deepEqual(fired, [`pick@${c.id}@1`]);
  });

  it('keep a late call through a despawned unit off the brain its slot went to next', () => {
    const { ai, units, id, a, fired, tick } = timed();

    units.despawn(a);

    const c = units.spawn(id.grunt, { side: 1 });

    ai.start(c, TIMERS.id.pick, 0.125);
    ai.start(a, TIMERS.id.raise, 0.125);
    ai.setFocus(a, 7);
    assert.equal(ai.hold(a, 'intro', true), false);
    tick(2);
    assert.deepEqual([fired, ai.focusOf(c)], [[`pick@${c.id}@1`], -1]);
  });

  it('fire once for a timer started again for the same tick, and not early for a reused brain’s later start', () => {
    const { ai, units, id, a, fired, tick } = timed();

    for (let i = 0; i < 40; i++) {
      ai.start(a, TIMERS.id.pick, 0.5);
    }

    tick(2);
    ai.start(a, TIMERS.id.raise, 0.25);
    units.despawn(a);

    const c = units.spawn(id.grunt, { side: 1 });

    ai.start(c, TIMERS.id.raise, 0.5);
    tick(2);
    assert.deepEqual(fired, ['pick@1@2', 'raise@3@4']);
  });

  it('fire a timer another’s firing started for now on the next tick, whatever a cancelled start left behind', () => {
    for (const hasLeftover of [false, true]) {
      const game = timed();
      const { ai, a, b } = game;

      const fire = (unit: Unit<UnitGame>, timer: TimerId): void => {
        game.fire(unit, timer);

        if (unit === b) {
          ai.start(a, TIMERS.id.pick, 0);
        }
      };

      ai.start(b, TIMERS.id.raise, 0.5);

      if (hasLeftover) {
        ai.start(a, TIMERS.id.pick, 0.5);
        ai.cancel(a, TIMERS.id.pick);
      }

      for (let i = 0; i < 3; i++) {
        game.clock.step();
        ai.step(fire);
      }

      assert.deepEqual(game.fired, ['raise@2@2', 'pick@1@3']);
    }
  });

  it('keep the timers due after one whose firing threw, for the next step', () => {
    const { ai, a, b, fired, tick, clock, fire } = timed();
    const { pick, raise } = TIMERS.id;

    ai.start(a, pick, 0.5);
    ai.start(b, raise, 0.5);
    ai.start(a, raise, 0.5);
    clock.step();
    clock.step();
    assert.throws(
      () =>
        ai.step((unit, timer) => {
          if (timer === pick) {
            throw new Error('fire');
          }

          fire(unit, timer);
        }),
      /fire/
    );
    assert.equal(ai.remaining(b, raise), 0);
    assert.equal(ai.step(fire), 0);
    tick();
    assert.deepEqual(fired, ['raise@2@3', 'raise@1@3']);
    assert.equal(ai.remaining(a, raise), undefined);
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

  it('refuse a timer id that is not an integer of the table', () => {
    const { ai, a, procs } = timed();

    for (const timer of [1.5, 32, -1, Number.NaN]) {
      assert.throws(() => {
        ai.start(a, toId<'timers'>(timer), 1);
      }, /Timer/);
      assert.throws(() => ai.take(a, toId<'timers'>(timer)), /Timer/);
      assert.throws(() => ai.remaining(a, toId<'timers'>(timer)), /Timer/);
      assert.throws(() => procs.prepare([setTimer<UnitGame>(toId<'timers'>(timer), 1)], 'Test'), /unknown timer/);
    }
  });

  it('take a name like __proto__ as a timer of its own', () => {
    const table = defineTimers(['__proto__', 'nap']);

    assert.equal(Object.getOwnPropertyDescriptor(table.id, '__proto__')?.value, 0);
    assert.equal(Object.getPrototypeOf(table.id), Object.prototype);
  });

  it('refuse the death hold among the game’s reasons', () => {
    const { spells, clock } = timed();

    assert.throws(() => createAiSystem({ spells, clock, timers: TIMERS, holds: ['intro', DEAD_HOLD] }), /system's own/);
  });

  it('come back from a hold in the order they were started, and collected ones in the order they were collected', () => {
    const { ai, a, fired, tick, clock } = timed();
    const { pick, raise } = TIMERS.id;

    ai.start(a, raise, 0.5);
    ai.start(a, pick, 0.5);
    ai.hold(a, 'intro', true);
    ai.hold(a, 'intro', false);
    tick(2);
    assert.deepEqual(fired, ['raise@1@2', 'pick@1@2']);

    const marked: string[] = [];

    const mark = (_unit: unknown, timer: TimerId): void => {
      marked.push(TIMERS.names[timer] ?? '?');
    };

    ai.start(a, raise, 0.25);
    ai.start(a, pick, 0.5);
    clock.step();
    assert.equal(ai.collect(mark), 1);
    // A tick on, raise still waits for delivery as pick falls due: the hold puts raise back first.
    clock.step();
    ai.hold(a, 'intro', true);
    ai.hold(a, 'intro', false);
    assert.equal(ai.collect(mark), 2);
    assert.deepEqual(marked, ['raise', 'raise', 'pick']);
  });

  it('read 0 left on a timer collected and not yet taken, as cancel finds it running', () => {
    const { ai, a, clock } = timed();

    ai.start(a, TIMERS.id.pick, 0.25);
    clock.step();
    ai.collect(() => undefined);
    assert.equal(ai.remaining(a, TIMERS.id.pick), 0);
    assert.equal(ai.cancel(a, TIMERS.id.pick), true);
    assert.equal(ai.remaining(a, TIMERS.id.pick), undefined);
  });

  it('round a held start to whole ticks, as a running one is', () => {
    const { ai, a } = timed();

    ai.start(a, TIMERS.id.pick, 0.3);
    ai.hold(a, 'intro', true);
    ai.start(a, TIMERS.id.raise, 0.3);
    assert.deepEqual([ai.remaining(a, TIMERS.id.pick), ai.remaining(a, TIMERS.id.raise)], [0.5, 0.5]);
  });

  it('tell whether a brain is held, and by which reason', () => {
    const { ai, units, auras, a, b } = timed();

    assert.equal(ai.isHeld(a), false);
    ai.hold(a, 'intro', true);
    auras.apply(b, auraId('freeze'));
    assert.deepEqual(
      [ai.isHeld(a), ai.isHeld(a, 'intro'), ai.isHeld(a, 'freeze'), ai.isHeld(a, 'nap'), ai.isHeld(b, 'freeze')],
      [true, true, false, false, true]
    );
    ai.hold(a, 'intro', false);
    assert.equal(ai.isHeld(a), false);
    units.despawn(b);
    assert.equal(ai.isHeld(b), false);
  });
});
