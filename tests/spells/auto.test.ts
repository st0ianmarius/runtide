import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { curveOf, scaled } from '../../src/modifiers/index.ts';
import { type AnySpellDef, autoNext, type SpellHost } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell, STATS, type Unit } from '../helpers/spell-game.ts';

/**
 * A game over `defs` with one caster, and `advance(n)`: `n` steps, each logged as `t<tick>`, then the caster's auto
 * clocks, then its casts.
 */
const autoGame = <const Spell extends string>(
  defs: Readonly<Record<Spell, AnySpellDef<Game>>>,
  host: Partial<SpellHost<Game>> = {}
) => {
  const game = makeSpellGame(defs, { host });
  const a = game.unit(1);

  const advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
      game.step();
      game.log.push(`t${game.clock.tick}`);
      game.spells.stepAuto(a);
      game.spells.step(a);
    }
  };

  /** The ticks on which `line` was logged. */
  const ticksOf = (line: string): number[] => {
    let tick = 0;

    return game.log.flatMap((entry) => {
      if (entry.startsWith('t') && !entry.includes(' ')) {
        tick = Number(entry.slice(1));
      }

      return entry === line ? [tick] : [];
    });
  };

  return { ...game, a, advance, ticksOf };
};

describe('auto clocks', () => {
  it('casts at once, then every interval, reset to the interval read at the cast with no carry-over', () => {
    const game = autoGame({
      swing: spell({ activation: { kind: 'auto', interval: 0.3 }, release: () => [mark('swing')] })
    });

    game.advance(6);
    assert.deepEqual(game.ticksOf('swing@1'), [1, 3, 5]);
    assert.ok(Math.abs(game.spells.autoClock(game.a, game.id.swing) - 0.05) < 1e-12);
  });

  it('casts with the step’s input and credit when the step gives them, and none and its own without', () => {
    const seen: string[] = [];

    const game = autoGame({
      swing: spell({
        activation: { kind: 'auto', interval: 0.25 },

        release: (ctx) => {
          seen.push(`input ${ctx.input?.id ?? 'none'} source ${ctx.source}`);

          return undefined;
        }
      })
    });

    const [foe, owner] = [game.unit(100), game.unit(7)];

    game.step();
    game.spells.stepAuto(game.a, { input: foe, source: owner.id });
    game.step();
    game.spells.stepAuto(game.a);
    assert.deepEqual(seen, ['input 100 source 7', 'input none source 1']);
  });

  it("reads the interval from the cast's stats", () => {
    const game = autoGame({
      volley: spell({
        activation: { kind: 'auto', interval: (ctx) => ctx.stats.interval },
        stats: { interval: scaled(1, curveOf('haste', 1)) },
        release: () => [mark('volley')]
      })
    });

    game.a.stats[STATS.id.abilityHaste] = 100;
    game.advance(1);
    assert.equal(game.spells.autoClock(game.a, game.id.volley), 0.5);
  });

  it('steps only armed clocks: a disarmed spell stops, and one armed again casts at once, or after its seconds', () => {
    const game = autoGame({
      swing: spell({ activation: { kind: 'auto', interval: 1 }, release: () => [mark('swing')] })
    });

    game.advance(1);
    assert.equal(game.spells.disarm(game.a, game.id.swing), true);
    assert.equal(game.spells.disarm(game.a, game.id.swing), false);
    game.advance(5);
    assert.equal(game.spells.autoClock(game.a, game.id.swing), 0);
    assert.equal(game.spells.arm(game.a, game.id.swing), true);
    assert.equal(game.spells.arm(game.a, game.id.swing, 5), false);
    game.advance(1);
    game.spells.disarm(game.a, game.id.swing);
    game.spells.arm(game.a, game.id.swing, 0.6);
    game.advance(4);
    assert.deepEqual(game.ticksOf('swing@1'), [1, 7, 10]);
  });

  it('refuses to arm a spell that is not auto, or with seconds that are not a finite number from 0', () => {
    const game = autoGame({
      swing: spell({ activation: { kind: 'auto', interval: 1 }, release: () => undefined }),
      bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined })
    });

    assert.throws(() => game.spells.arm(game.a, game.id.bolt), /not an auto spell/);
    assert.throws(() => game.spells.arm(game.unit(2), game.id.swing, -1), /finite seconds/);
  });

  it("spends the whole interval on a refusal by the gates or canCast, or what the game's next says", () => {
    const game = autoGame({
      held: spell({
        activation: { kind: 'auto', interval: 1 },
        canCast: () => false,
        release: () => undefined
      }),
      eager: spell({
        activation: {
          kind: 'auto',
          interval: 1,

          next: (report, interval) => (report.refusal === 'canCast' ? 0.25 : autoNext(report, interval))
        },
        canCast: () => false,
        release: () => undefined
      })
    });

    game.advance(1);
    assert.equal(game.spells.autoClock(game.a, game.id.held), 1);
    assert.equal(game.spells.autoClock(game.a, game.id.eager), 0.25);
  });

  it('retries on the next step when the cast finds no target, or spends when the game says so', () => {
    let aims = 0;

    const game = autoGame({
      seek: spell({
        activation: { kind: 'auto', interval: 1 },

        target: () => {
          aims += 1;

          return undefined;
        },

        release: () => undefined
      }),
      patient: spell({
        activation: { kind: 'auto', interval: 1, next: (_report, interval) => interval },
        target: () => undefined,
        release: () => undefined
      })
    });

    game.advance(3);
    assert.equal(aims, 3);
    assert.equal(game.spells.autoClock(game.a, game.id.patient), 0.5);
  });

  it('waits at zero while the caster is not ready, attempting no cast, and casts on the first step it is', () => {
    let isNear = false;
    let asked = 0;
    let aims = 0;

    const game = autoGame({
      swing: spell({
        activation: {
          kind: 'auto',
          interval: 1,

          ready: () => {
            asked += 1;

            return isNear;
          }
        },

        target: (ctx) => {
          aims += 1;

          return ctx.caster;
        },

        release: () => [mark('swing')]
      })
    });

    game.advance(3);
    assert.deepEqual(
      [asked, aims, game.ticksOf('swing@1'), game.spells.autoClock(game.a, game.id.swing)],
      [3, 0, [], 0]
    );
    isNear = true;
    game.advance(1);
    assert.deepEqual(game.ticksOf('swing@1'), [4]);
    game.advance(3);
    assert.equal(asked, 4, 'a clock still counting asks nothing');
  });

  it('spends the interval after a cast whose release set nothing off, unless the game’s next retries it', () => {
    const game = autoGame({
      whiff: spell({
        activation: {
          kind: 'auto',
          interval: 1,
          next: (report, interval) => (report.went === 0 ? 0 : interval)
        },
        release: () => []
      }),
      stubborn: spell({ activation: { kind: 'auto', interval: 1 }, release: () => [] }),
      windup: spell({
        activation: { kind: 'auto', interval: 1 },
        timeline: { windup: { seconds: 0.5 } },
        release: () => []
      })
    });

    game.advance(2);
    assert.deepEqual(game.ticksOf('end whiff@1 released'), [1, 2]);
    assert.deepEqual(game.ticksOf('end stubborn@1 released'), [1]);
    assert.deepEqual(game.ticksOf('start windup@1'), [1]);
    assert.equal(game.spells.autoClock(game.a, game.id.windup), 0.75);
  });

  it('refuses a next that is not seconds from 0, and a next that is not a function at load', () => {
    const game = autoGame({
      broken: spell({
        activation: { kind: 'auto', interval: 1, next: () => -1 },
        release: () => undefined
      })
    });

    const activation = { kind: 'auto', interval: 1 } as const;

    assert.throws(() => {
      game.advance(1);
    }, /Spell broken: an auto clock's next is finite seconds from 0/);
    Reflect.set(activation, 'next', 0);
    assert.throws(() => autoGame({ bad: spell({ activation, release: () => [] }) }), /next is a function/);
  });

  it('steps every other clock once when a cast disarms its own or arms another', () => {
    const late: { disarm?: () => void; arm?: () => void } = {};

    const game = autoGame({
      opener: spell({
        activation: { kind: 'auto', interval: 1 },

        release: () => {
          late.disarm?.();
          late.arm?.();

          return [mark('opener')];
        }
      }),
      swing: spell({ activation: { kind: 'auto', interval: 1 }, release: () => [mark('swing')] }),
      volley: spell({ activation: { kind: 'auto', interval: 1 }, release: () => [mark('volley')] })
    });

    late.disarm = () => void game.spells.disarm(game.a, game.id.opener);
    late.arm = () => void game.spells.arm(game.a, game.id.volley, 0.5);
    game.spells.disarm(game.a, game.id.volley);
    game.advance(1);
    assert.deepEqual(
      game.log.filter((line) => !line.includes(' ') && !line.startsWith('t')),
      ['opener@1', 'swing@1']
    );
    assert.equal(game.spells.autoClock(game.a, game.id.volley), 0.25);
  });

  it('reads 0 for a spell that is not auto', () => {
    const game = autoGame({
      bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined })
    });

    assert.equal(game.spells.autoClock(game.a, game.id.bolt), 0);
  });
});

describe('an auto clock after the caster’s other casts', () => {
  it('waits out the caster’s casts through its ready, and is reset to its interval by the game as each ends', () => {
    const late: { isCasting?: (unit: Unit) => boolean; reset?: (unit: Unit) => void } = {};

    const game = autoGame({
      swing: spell({
        activation: {
          kind: 'auto',
          interval: 1,
          ready: (caster) => late.isCasting?.(caster) !== true
        },
        release: () => [mark('swing')]
      }),
      bolt: spell({ activation: { kind: 'auto', interval: 2 }, release: () => [mark('bolt')] }),
      roar: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 0.5 }, recover: { seconds: 0.5 } },
        release: () => undefined,

        onEnd: (ctx) => {
          late.reset?.(ctx.caster);

          return undefined;
        }
      })
    });

    late.isCasting = (unit) => game.spells.isCasting(unit);
    late.reset = (unit) => void game.spells.setClock(unit, game.id.swing, 1);

    game.advance(2);
    assert.equal(game.spells.autoClock(game.a, game.id.swing), 0.75);
    game.spells.cast(game.a, game.id.roar);
    game.advance(3);
    assert.deepEqual(
      game.log.filter((line) => line === 'swing@1'),
      ['swing@1']
    );
    assert.equal(game.spells.autoClock(game.a, game.id.swing), 0);
    game.advance(1);
    assert.equal(game.spells.autoClock(game.a, game.id.swing), 1);
    assert.equal(game.spells.autoClock(game.a, game.id.bolt), 0.75);
  });

  it('sets only an armed clock, to finite seconds from 0, and refuses a ready that is not a function', () => {
    const game = autoGame({
      swing: spell({ activation: { kind: 'auto', interval: 1 }, release: () => undefined }),
      bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined })
    });

    const unready = { kind: 'auto', interval: 1 } as const;

    assert.equal(game.spells.setClock(game.a, game.id.swing, 0.5), true);
    assert.equal(game.spells.autoClock(game.a, game.id.swing), 0.5);
    assert.equal(game.spells.setClock(game.a, game.id.bolt, 0.5), false);
    assert.throws(() => game.spells.setClock(game.a, game.id.swing, -1), /finite seconds from 0/);
    Reflect.set(unready, 'ready', true);
    assert.throws(() => autoGame({ x: spell({ activation: unready, release: () => undefined }) }), /ready/);
  });
});

describe('auto clocks under a throwing cast', () => {
  it('end the walk as if it finished: a clock armed after counts its full time', () => {
    let isBroken = true;

    const game = makeSpellGame({
      first: spell({
        activation: { kind: 'auto', interval: 1 },

        release: () => {
          if (isBroken) {
            isBroken = false;

            throw new Error('game bug');
          }

          return [mark('first')];
        }
      }),
      second: spell({ activation: { kind: 'auto', interval: 1 }, release: () => [mark('second')] })
    });

    const unit = game.unit(1);

    game.spells.disarm(unit, game.id.second);
    game.step();
    assert.throws(() => {
      game.spells.stepAuto(unit);
    }, /game bug/);
    game.spells.arm(unit, game.id.second, 1);
    assert.equal(game.spells.autoClock(unit, game.id.second), 1);
  });
});
