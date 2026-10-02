import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POOL_MIN_FREE } from '../../src/core/index.ts';
import { run } from '../../src/procs/index.ts';
import { type AnySpellDef, type CastHandle, lockBefore, NO_CAST } from '../../src/spells/index.ts';
import { aura, type Game, makeSpellGame, mark, spell } from '../helpers/spell-game.ts';

/**
 * A game over `defs` with one caster, and `advance(n)`: `n` steps, each logged as `t<tick>` before the caster's casts
 * step, so the log reads as a timeline.
 */
const timeline = <const Spell extends string>(defs: Readonly<Record<Spell, AnySpellDef<Game>>>) => {
  const game = makeSpellGame(defs);
  const a = game.unit(1);

  const advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
      game.step();
      game.log.push(`t${game.clock.tick}`);
      game.spells.step(a);
    }
  };

  return { ...game, a, advance };
};

describe('stage order', () => {
  it('captures independent stage durations per cast while retaining the authored hooks and defaults', () => {
    const read: string[] = [];

    const game = timeline({
      beam: spell({
        activation: { kind: 'trigger' },
        timeline: {
          windup: {
            seconds: () => {
              read.push('windup');
              return 1;
            }
          },
          channel: {
            seconds: () => {
              read.push('channel');
              return 1;
            },
            every: 0.25,
            tick: () => [mark('beat')]
          },
          recover: {
            seconds: () => {
              read.push('recover');
              return 1;
            }
          }
        },
        release: () => [mark('release')]
      })
    });

    const stages = { windup: 0.5, channel: 0.25, recover: 0.25 };
    const shorter = game.spells.cast(game.a, game.id.beam, { stages }).handle;
    const ordinary = game.spells.cast(game.a, game.id.beam).handle;

    stages.channel = 9;
    stages.recover = 9;
    game.advance(2);
    assert.equal(game.spells.get(shorter)?.stage, 'channel');
    assert.equal(game.spells.get(shorter)?.stageSeconds, 0.25);
    assert.equal(game.spells.get(ordinary)?.stage, 'windup');
    game.advance();
    assert.equal(game.spells.get(shorter)?.stage, 'recover');
    assert.equal(game.spells.get(shorter)?.stageSeconds, 0.25);
    assert.equal(game.log.filter((line) => line === 'beat@1').length, 1);
    game.advance();
    assert.equal(game.spells.isRunning(shorter), false);
    assert.equal(game.spells.get(ordinary)?.stageSeconds, 1);
    assert.deepEqual(read, ['windup', 'channel']);
    game.advance(8);
    assert.equal(game.spells.isRunning(ordinary), false);
    assert.deepEqual(read, ['windup', 'channel', 'recover']);
    assert.equal(game.registry.get(game.id.beam).timeline?.channel?.every, 0.25);
  });

  it('can add missing stages, skip authored durations with zero, and forget overrides on reuse', () => {
    const game = timeline({
      instant: spell({ activation: { kind: 'trigger' }, release: () => [mark('release')] }),
      slow: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 }, channel: { seconds: 1 }, recover: { seconds: 1 } },
        release: () => [mark('release')]
      })
    });

    const handle = game.spells.cast(game.a, game.id.instant, {
      stages: { windup: 0.25, channel: 0.25, recover: 0.25 }
    }).handle;

    game.advance();
    assert.equal(game.spells.get(handle)?.stage, 'channel');
    game.advance();
    assert.equal(game.spells.get(handle)?.stage, 'recover');
    game.advance();
    assert.equal(game.spells.isRunning(handle), false);
    assert.equal(game.spells.cast(game.a, game.id.instant).status, 'ended');
    assert.equal(
      game.spells.cast(game.a, game.id.slow, { stages: { windup: 0, channel: 0, recover: 0 } }).status,
      'ended'
    );
    const ordinary = game.spells.cast(game.a, game.id.slow).handle;

    assert.equal(game.spells.get(ordinary)?.stageSeconds, 1);
  });

  it('uses an overridden windup when prestarting release cooldowns', () => {
    const game = makeSpellGame(
      {
        slow: spell({
          activation: { kind: 'trigger' },
          timeline: { windup: { seconds: 1 } },
          cooldown: { aura: 'icd', seconds: 2, startsOn: 'release' },
          release: () => undefined
        })
      },
      { auras: { icd: aura({ duration: 2 }) } }
    );

    const caster = game.unit(1);

    game.spells.startCooldowns(caster, game.id.slow, { stages: { windup: 0.5 } });
    assert.equal(game.spells.cooldownLeft(caster, game.id.slow), 2.5);
    const handle = game.spells.cast(caster, game.id.slow, { committed: true, stages: { windup: 0.5 } }).handle;

    assert.equal(game.spells.get(handle)?.stageSeconds, 0.5);
  });

  it('counts a windup down, releases on its last step, recovers, then ends', () => {
    const game = timeline({
      slow: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 }, recover: { seconds: 0.5 } },
        release: () => [mark('release')]
      })
    });

    const handle = game.spells.cast(game.a, game.id.slow).handle;

    assert.equal(game.spells.get(handle)?.stage, 'windup');
    game.advance(6);
    assert.deepEqual(game.log, [
      'start slow@1',
      't1',
      't2',
      't3',
      't4',
      'release@1',
      'release slow@1',
      't5',
      't6',
      'end slow@1 released'
    ]);
    assert.equal(game.spells.isRunning(handle), false);
  });

  it('keeps an outcome finished from the release, and releases nothing for a cast track ended', () => {
    const game = timeline({
      charge: spell({
        activation: { kind: 'trigger' },
        timeline: { channel: { seconds: 1, every: 0.25, tick: () => [mark('beat')] }, recover: { seconds: 0.25 } },

        release: (ctx) => {
          game.spells.finish(ctx.cast, 'blocked');

          return undefined;
        }
      }),

      slam: spell({
        activation: { kind: 'trigger' },
        target: () => ({ x: 1, z: 0 }),

        timeline: {
          windup: {
            seconds: 0.25,

            track: (ctx, aim) => {
              game.spells.cancel(ctx.cast);

              return aim;
            }
          }
        },

        release: () => [mark('slam')]
      })
    });

    game.spells.cast(game.a, game.id.charge);
    game.spells.cast(game.a, game.id.slam);
    game.advance(3);
    assert.deepEqual(game.log, [
      'start charge@1',
      'start slam@1',
      't1',
      'end charge@1 blocked',
      'end slam@1 cancelled',
      't2',
      't3'
    ]);
  });

  it('tracks the target through its windup until lockBefore’s lock', () => {
    let aims = 0;

    const game = timeline({
      slam: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1, track: lockBefore(0.5) }, recover: { seconds: 0.25 } },

        target: () => {
          aims += 1;

          return aims;
        },

        release: (_ctx, target) => [mark(`slam at ${target}`)]
      })
    });

    const handle = game.spells.cast(game.a, game.id.slam).handle;

    game.advance(1);
    assert.equal(game.spells.get(handle)?.target, 2);
    game.advance(3);
    assert.equal(aims, 2);
    assert.ok(game.log.includes('slam at 2@1'));
    game.advance(1);
    assert.equal(game.log.at(-1), 'end slam@1 released');
  });

  it('cancels a windup whose cancelIf holds: onEnd, with no release and no recovery', () => {
    let isLost = false;

    const game = timeline({
      tether: spell({
        activation: { kind: 'trigger' },
        timeline: {
          windup: { seconds: 1, cancelIf: () => isLost },
          recover: { seconds: 1 }
        },
        release: () => [mark('release')],
        onEnd: (_ctx, outcome) => [mark(`onEnd ${outcome}`)]
      })
    });

    game.spells.cast(game.a, game.id.tether);
    game.advance(1);
    isLost = true;
    game.advance(1);
    assert.deepEqual(game.log, ['start tether@1', 't1', 't2', 'onEnd cancelled@1', 'end tether@1 cancelled']);
  });

  it('beats a channel every `every` seconds, the last on its last step, then recovers', () => {
    const game = timeline({
      beam: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: { seconds: 1, every: 0.5, tick: (ctx) => [mark(`beat ${ctx.elapsed}`)] },
          recover: { seconds: 0.25 }
        },
        release: () => undefined
      })
    });

    game.spells.cast(game.a, game.id.beam);
    game.advance(5);
    assert.deepEqual(game.log, [
      'start beam@1',
      'release beam@1',
      't1',
      't2',
      'beat 0.5@1',
      't3',
      't4',
      'beat 1@1',
      't5',
      'end beam@1 released'
    ]);
  });

  it('ticks a channel with no beat every step, and catches up a beat shorter than the step', () => {
    const game = timeline({
      stream: spell({
        activation: { kind: 'trigger' },
        timeline: { channel: { seconds: 0.5, tick: () => [mark('tick')] } },
        release: () => undefined
      }),
      burst: spell({
        activation: { kind: 'trigger' },
        timeline: { channel: { seconds: 1, every: 0.1, tick: () => [mark('pulse')] } },
        release: () => undefined
      })
    });

    game.spells.cast(game.a, game.id.stream);
    game.spells.cast(game.a, game.id.burst);
    game.advance(4);
    assert.equal(game.log.filter((line) => line === 'tick@1').length, 2);
    assert.equal(game.log.filter((line) => line === 'pulse@1').length, 10);
  });

  it('beats no more once a beat has finished its channel, though more were due in the step', () => {
    let handle = NO_CAST;

    const game = timeline({
      burst: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: {
            seconds: 1,
            every: 0.1,

            tick: () => {
              game.spells.finish(handle, 'blocked');

              return [mark('pulse')];
            }
          },
          recover: { seconds: 1 }
        },
        release: () => undefined
      })
    });

    handle = game.spells.cast(game.a, game.id.burst).handle;
    game.advance(2);
    assert.deepEqual(
      game.log.filter((line) => line === 'pulse@1'),
      ['pulse@1']
    );
  });

  it('reads a channel’s beat from the cast as it starts (hasted ticks)', () => {
    const game = timeline({
      storm: spell({
        activation: { kind: 'trigger' },
        stats: { beat: 0.5 },
        timeline: {
          channel: { seconds: 1, every: (ctx) => ctx.stats.beat / 2, tick: () => [mark('beat')] }
        },
        release: () => undefined
      })
    });

    game.spells.cast(game.a, game.id.storm);
    game.advance(4);
    assert.equal(game.log.filter((line) => line === 'beat@1').length, 4);
  });

  it('reads live stats again before each beat, several due in one step among them', () => {
    const seen: number[] = [];
    let charge = 0;

    const game = timeline({
      surge: spell({
        activation: { kind: 'trigger' },
        live: true,
        stats: () => ({ charge }),
        timeline: {
          channel: {
            seconds: 0.25,
            every: 0.125,

            tick: (ctx) => {
              charge += 1;
              seen.push(ctx.stats.charge);

              return undefined;
            }
          }
        },
        release: () => undefined
      })
    });

    game.spells.cast(game.a, game.id.surge);
    charge = 1;
    game.advance(1);
    assert.deepEqual(seen, [1, 2]);
  });

  it('moves a stage’s end by a delay: pushback later, a negative one sooner, never below none left', () => {
    const game = timeline({
      heal: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 } },
        release: () => [mark('heal')]
      })
    });

    const { handle } = game.spells.cast(game.a, game.id.heal);

    game.advance(2);
    assert.equal(game.spells.delay(handle, 0.5), true);
    assert.equal(game.spells.get(handle)?.stageSeconds, 1.5);
    game.advance(3);
    assert.equal(game.log.includes('heal@1'), false);
    game.advance(1);
    assert.equal(game.log.includes('heal@1'), true);

    const again = game.spells.cast(game.a, game.id.heal).handle;

    assert.equal(game.spells.delay(again, -5), true);
    game.advance(1);
    assert.equal(game.log.filter((line) => line === 'heal@1').length, 2);
    assert.equal(game.spells.delay(again, 1), false);
    assert.throws(() => game.spells.delay(handle, Number.NaN), /finite number of seconds/);
  });

  it('starts a cast paused under an interrupt its caster holds that it answers by pausing', () => {
    const game = timeline({
      chant: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 0.25 }, interrupts: { stun: 'pause' } },
        release: () => [mark('chant')]
      }),
      instant: spell({
        activation: { kind: 'trigger' },
        timeline: { interrupts: { stun: 'pause' } },
        release: () => [mark('instant')]
      })
    });

    game.spells.interrupt(game.a, 'stun');

    const { handle } = game.spells.cast(game.a, game.id.chant);

    game.spells.cast(game.a, game.id.instant);
    game.advance(3);
    assert.equal(game.spells.get(handle)?.stage, 'windup');
    assert.deepEqual(
      game.log.filter((line) => !line.includes(' ') && !line.startsWith('t')),
      []
    );
    game.spells.endInterrupt(game.a, 'stun');
    game.advance(1);
    assert.deepEqual(
      game.log.filter((line) => !line.includes(' ') && !line.startsWith('t')),
      ['chant@1', 'instant@1']
    );
  });

  it('breaks a channel whose breakIf holds, and reads the recovery with the outcome known', () => {
    let isOut = false;

    const game = timeline({
      leash: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: { seconds: 5, breakIf: () => isOut },
          recover: { seconds: (ctx) => (ctx.outcome === 'broken' ? 0.5 : 0) }
        },
        release: () => undefined
      })
    });

    game.spells.cast(game.a, game.id.leash);
    game.advance(1);
    isOut = true;
    game.advance(3);
    assert.deepEqual(game.log.slice(-4), ['t2', 't3', 't4', 'end leash@1 broken']);
  });
});

describe('hooks for the cast rules (F16)', () => {
  /** A spell that winds up 1 s, pauses on a stun and cancels on death. */
  const aimed = spell({
    activation: { kind: 'trigger' },
    timeline: { windup: { seconds: 1 }, interrupts: { stun: 'pause', death: 'cancel' } },
    release: () => [mark('release')]
  });

  it('pauses a cast, which then does not count down, until it resumes', () => {
    const game = timeline({ aimed });
    const handle = game.spells.cast(game.a, game.id.aimed).handle;

    game.advance(1);
    assert.equal(game.spells.pause(handle), true);
    assert.equal(game.spells.get(handle)?.isPaused, true);
    game.advance(10);
    assert.equal(game.spells.get(handle)?.remaining, 0.75);
    game.spells.resume(handle);
    game.advance(3);
    assert.ok(game.log.includes('release@1'));
  });

  it('answers an interrupt as its timeline says: pause until it ends, cancel, or nothing', () => {
    const game = timeline({
      aimed,
      plain: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 0.5 } },
        release: () => undefined
      })
    });

    const first = game.spells.cast(game.a, game.id.aimed).handle;

    game.spells.cast(game.a, game.id.plain);
    assert.equal(game.spells.interrupt(game.a, 'stun'), 1);
    game.advance(2);
    assert.equal(game.spells.get(first)?.remaining, 1);
    assert.ok(game.log.includes('end plain@1 released'));
    game.spells.pause(first);
    assert.equal(game.spells.endInterrupt(game.a, 'stun'), 1);
    assert.equal(game.spells.get(first)?.isPaused, true);
    game.spells.resume(first);
    game.advance(1);
    assert.equal(game.spells.interrupt(game.a, 'death'), 1);
    assert.equal(game.log.at(-1), 'end aimed@1 cancelled');
  });

  it('holds an interrupt on the caster until it ends, and cancels every cast at once', () => {
    const game = timeline({ aimed });

    assert.equal(game.spells.interrupt(game.a, 'stun'), 0);
    assert.equal(game.spells.isInterrupted(game.a, 'stun'), true);
    assert.equal(game.spells.isInterrupted(game.a, 'death'), false);
    game.spells.endInterrupt(game.a, 'stun');
    assert.equal(game.spells.isInterrupted(game.a, 'stun'), false);
    game.spells.cast(game.a, game.id.aimed);
    game.spells.cast(game.a, game.id.aimed);
    assert.equal(game.spells.cancelAll(game.a), 2);
    assert.equal(game.spells.cancelAll(game.a), 0);
    assert.deepEqual(game.log.slice(-2), ['end aimed@1 cancelled', 'end aimed@1 cancelled']);
  });

  it('holds an interrupt until as many ends as raises, so overlapping stuns pause a cast until both end', () => {
    const game = timeline({ aimed });
    const handle = game.spells.cast(game.a, game.id.aimed).handle;

    assert.deepEqual([game.spells.interrupt(game.a, 'stun'), game.spells.interrupt(game.a, 'stun')], [1, 0]);
    assert.equal(game.spells.endInterrupt(game.a, 'stun'), 0);
    assert.equal(game.spells.isInterrupted(game.a, 'stun'), true);
    game.advance(2);
    assert.equal(game.spells.get(handle)?.remaining, 1, 'still paused by the other stun');
    assert.equal(game.spells.endInterrupt(game.a, 'stun'), 1);
    assert.equal(game.spells.endInterrupt(game.a, 'stun'), 0, 'an end with none held does nothing');
    assert.equal(game.spells.isInterrupted(game.a, 'stun'), false);
    assert.equal(game.spells.interrupt(game.a, 'stun'), 1, 'and leaves nothing owed');
  });

  it('refuses a cast its caster’s held interrupt would cancel, one its cancelled cast starts from onEnd too', () => {
    const again: { status?: string; refusal?: string } = {};

    const game = timeline({
      aimed,
      chain: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 }, interrupts: { death: 'cancel' } },
        release: () => undefined,

        onEnd: () => [
          run('again', () => {
            Object.assign(again, game.spells.cast(game.a, game.id.aimed));
          })
        ]
      })
    });

    game.spells.cast(game.a, game.id.chain);
    game.spells.interrupt(game.a, 'death');
    assert.deepEqual([again.status, again.refusal], ['refused', 'interrupted']);
    assert.equal(game.spells.isCasting(game.a), false);
    assert.equal(game.spells.check(game.a, game.id.aimed), 'interrupted');
    assert.equal(game.spells.cast(game.a, game.id.aimed).refusal, 'interrupted');
  });

  it('cancels a cast from outside, and stops the rest of a course its own procs ended', () => {
    let self: CastHandle | undefined;

    const game = timeline({
      aimed,
      rash: spell({
        activation: { kind: 'trigger' },
        timeline: { recover: { seconds: 1 } },

        release: (ctx) => {
          self = ctx.cast;

          return [run('end', () => game0.spells.cancel(ctx.cast)), mark('after')];
        },

        onEnd: (_ctx, outcome) => [mark(`onEnd ${outcome}`)]
      })
    });

    const game0 = game;
    const handle = game.spells.cast(game.a, game.id.aimed).handle;

    assert.equal(game.spells.cancel(handle), true);
    assert.equal(game.spells.cancel(handle), false);

    const report = game.spells.cast(game.a, game.id.rash);

    assert.equal(report.status, 'ended');
    assert.equal(game.spells.isRunning(self ?? handle), false);
    // The release's list runs on after the cancel, but the cast goes no further: no release event, no recovery.
    assert.deepEqual(game.log.slice(-4), ['start rash@1', 'onEnd cancelled@1', 'end rash@1 cancelled', 'after@1']);
  });

  it("finishes a channel's payload with the game's outcome, its recovery following", () => {
    const game = timeline({
      charge: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: { seconds: 2 },
          recover: { seconds: (ctx) => (ctx.outcome === 'blocked' ? 0.5 : 0.25) }
        },
        release: () => undefined
      })
    });

    const handle = game.spells.cast(game.a, game.id.charge).handle;

    game.advance(1);
    assert.equal(game.spells.finish(handle, 'blocked'), true);
    assert.equal(game.spells.get(handle)?.stage, 'recover');
    assert.equal(game.spells.finish(handle, 'blocked'), false);
    game.advance(2);
    assert.equal(game.log.at(-1), 'end charge@1 blocked');
    assert.deepEqual(game.spells.registry.outcomes, ['released', 'cancelled', 'broken', 'blocked']);

    const next = game.spells.cast(game.a, game.id.charge).handle;

    const finish = (outcome: string) => (): unknown => Reflect.apply(game.spells.finish, undefined, [next, outcome]);

    assert.throws(finish('stuck'), /cannot finish as stuck/);
    assert.throws(finish('cancelled'), /cannot finish as cancelled/);
  });
});

describe('stepping per caster', () => {
  it('steps casts in the order they started, and not one started during the step', () => {
    const game = timeline({
      opener: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: {
            seconds: 0.5,
            tick: (ctx) => [run('follow', () => game0.spells.cast(ctx.caster, game0.id.follow))]
          }
        },
        release: () => undefined
      }),
      follow: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 0.25 } },
        release: () => undefined
      })
    });

    const game0 = game;

    game.spells.cast(game.a, game.id.opener);
    game.advance(1);
    assert.equal(game.log.filter((line) => line === 'release follow@1').length, 0);
    game.advance(1);
    assert.equal(game.log.filter((line) => line === 'release follow@1').length, 1);
  });

  it('makes no new cast records in a steady state', () => {
    const game = timeline({
      loop: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 0.5 } },
        release: () => undefined
      })
    });

    for (let i = 0; i < POOL_MIN_FREE + 20; i++) {
      game.spells.cast(game.a, game.id.loop);
      game.advance(2);
    }

    assert.equal(game.spells.pool.created, POOL_MIN_FREE + 1);
    assert.equal(game.spells.pool.live, 0);
  });
});
