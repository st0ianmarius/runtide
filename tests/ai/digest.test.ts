import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { digest, DIGEST_START } from '../../src/core/index.ts';
import { makeUnitGame, TIMERS } from '../helpers/unit-game.ts';

/** A game with one grunt, its clock stepped `ticks` times. */
const grunt = (ticks = 0) => {
  const game = makeUnitGame({ grunt: {} });
  const unit = game.units.spawn(game.id.grunt, { side: 1 });

  for (let i = 0; i < ticks; i++) {
    game.clock.step();
  }

  return { ...game, unit };
};

describe('ai.digest', () => {
  it('folds what a timer has left, not the tick it is due on', () => {
    const early = grunt();
    const late = grunt(3);

    early.ai.start(early.unit, TIMERS.id.pick, 1);
    late.ai.start(late.unit, TIMERS.id.pick, 1);
    assert.equal(early.ai.digest(early.unit, DIGEST_START), late.ai.digest(late.unit, DIGEST_START));
    early.clock.step();
    assert.notEqual(early.ai.digest(early.unit, DIGEST_START), late.ai.digest(late.unit, DIGEST_START));
  });

  it('moves with each timer, hold, collected timer and focus', () => {
    const { ai, unit, clock } = grunt();
    const digests = new Set<number>();

    const note = (): void => {
      const before = digests.size;

      digests.add(ai.digest(unit, DIGEST_START));
      assert.equal(digests.size, before + 1, 'each change moves the digest');
    };

    note();
    ai.start(unit, TIMERS.id.pick, 0.5);
    note();
    ai.start(unit, TIMERS.id.raise, 0.5);
    note();
    ai.hold(unit, 'intro', true);
    note();
    ai.hold(unit, 'intro', false);
    // Let go, its timers count from what they had left: the same state as before the hold.
    assert.equal(digests.has(ai.digest(unit, DIGEST_START)), true);
    ai.setFocus(unit, 7);
    note();

    for (let i = 0; i < 10 && ai.remaining(unit, TIMERS.id.pick) !== 0; i++) {
      clock.step();
      ai.collect(() => undefined);
    }

    note();
    assert.equal(ai.take(unit, TIMERS.id.pick), true);
    note();
  });

  it('folds −1 alone for a unit whose brain was freed', () => {
    const { ai, unit, units } = grunt();

    ai.start(unit, TIMERS.id.pick, 1);
    units.despawn(unit);
    assert.equal(ai.digest(unit, DIGEST_START), digest(DIGEST_START, -1));
  });
});
