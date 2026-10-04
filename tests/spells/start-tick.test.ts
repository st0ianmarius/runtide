import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeSpellGame, mark, spell, type Unit } from '../helpers/spell-game.ts';

/** A half-second windup (two steps of the test clock) that marks its release. */
const quick = spell({
  activation: { kind: 'trigger' },
  timeline: { windup: { seconds: 0.5 } },
  release: () => [mark('quick')]
});

/** No windup, a half-second recovery: it releases as it is cast. */
const snap = spell({
  activation: { kind: 'trigger' },
  timeline: { recover: { seconds: 0.5 } },
  release: () => [mark('snap')]
});

/** A one-second swing clock. */
const swing = spell({ activation: { kind: 'auto', interval: 1 }, release: () => [mark('swing')] });

/** The ticks on which each of `lines` was logged, by line, reading `t<tick>` entries as the tick marks. */
const ticksOf = (log: readonly string[], line: string): number[] => {
  let tick = 0;

  return log.flatMap((entry) => {
    if (/^t\d+$/.test(entry)) {
      tick = Number(entry.slice(1));
    }

    return entry === line ? [tick] : [];
  });
};

describe('a cast started on a tick', () => {
  it('is not stepped by its caster’s step that tick, so it runs its full windup wherever in the tick it began', () => {
    const game = makeSpellGame({ quick });
    const [before, after] = [game.unit(1), game.unit(2)];

    game.step();
    game.log.push(`t${game.clock.tick}`);
    game.spells.cast(before, game.id.quick);
    game.spells.step(before);
    game.spells.step(after);
    game.spells.cast(after, game.id.quick);

    for (let i = 0; i < 3; i++) {
      game.step();
      game.log.push(`t${game.clock.tick}`);
      game.spells.step(before);
      game.spells.step(after);
    }

    assert.deepEqual([ticksOf(game.log, 'quick@1'), ticksOf(game.log, 'quick@2')], [[3], [3]]);
  });

  it('still passes zero-length stages at the cast, its next stage counting from the next tick', () => {
    const game = makeSpellGame({ snap });
    const hero = game.unit(1);
    const { handle } = game.spells.cast(hero, game.id.snap);

    assert.equal(game.log.includes('snap@1'), true);
    game.spells.step(hero);
    assert.equal(game.spells.get(handle)?.remaining, 0.5);
    game.step();
    game.spells.step(hero);
    game.step();
    game.spells.step(hero);
    assert.equal(game.spells.isRunning(handle), false);
  });
});

describe('an auto clock set or armed on a tick', () => {
  /** Two casters whose swing is reset to one second on tick 1, `early` before its auto step and `late` after it. */
  const resetGame = () => {
    const game = makeSpellGame({ swing });
    const [early, late] = [game.unit(1), game.unit(2)];

    const advance = (units: readonly Unit[]) => {
      game.step();
      game.log.push(`t${game.clock.tick}`);

      for (const unit of units) {
        game.spells.stepAuto(unit);
      }
    };

    return { game, early, late, advance };
  };

  it('counts from the next tick’s step whether set before or after the caster’s step that tick', () => {
    const { game, early, late, advance } = resetGame();

    game.step();
    game.log.push(`t${game.clock.tick}`);
    game.spells.setClock(early, game.id.swing, 1);
    game.spells.stepAuto(early);
    game.spells.stepAuto(late);
    game.spells.setClock(late, game.id.swing, 1);
    assert.deepEqual([game.spells.autoClock(early, game.id.swing), game.spells.autoClock(late, game.id.swing)], [1, 1]);

    for (let i = 0; i < 5; i++) {
      advance([early, late]);
    }

    assert.deepEqual([ticksOf(game.log, 'swing@1'), ticksOf(game.log, 'swing@2')], [[5], [1, 5]]);
  });

  it('fires on the next tick’s step when armed at zero, before or after the caster’s step', () => {
    const { game, early, late, advance } = resetGame();

    game.spells.disarm(early, game.id.swing);
    game.spells.disarm(late, game.id.swing);
    game.step();
    game.log.push(`t${game.clock.tick}`);
    game.spells.arm(early, game.id.swing);
    game.spells.stepAuto(early);
    game.spells.stepAuto(late);
    game.spells.arm(late, game.id.swing);
    advance([early, late]);
    assert.deepEqual([ticksOf(game.log, 'swing@1'), ticksOf(game.log, 'swing@2')], [[2], [2]]);
  });
});
