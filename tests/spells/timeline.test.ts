import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { run } from '../../src/procs/index.ts';
import type { AnySpellDef, CastHandle } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell } from '../helpers/spell-game.ts';

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

describe('stage order (§II.3.3)', () => {
  it('counts a windup down, releases on its last step, recovers, then ends', () => {
    const game = timeline({
      slow: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 }, recover: { seconds: 0.5 } },
        release: () => [mark('release')],
      }),
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
      'end slow@1 released',
    ]);
    assert.equal(game.spells.isRunning(handle), false);
  });

  it("takes an ai activation's windup and recovery, tracking the target until its lock", () => {
    let aims = 0;

    const game = timeline({
      slam: spell({
        activation: { kind: 'ai', windup: 1, lock: 0.5, recover: 0.25 },

        target: () => {
          aims += 1;

          return aims;
        },

        release: (_ctx, target) => [mark(`slam at ${target}`)],
      }),
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

  it('cancels a windup whose cancelIf holds: onCancel, then onEnd, with no release and no recovery', () => {
    let isLost = false;

    const game = timeline({
      tether: spell({
        activation: { kind: 'trigger' },
        timeline: {
          windup: { seconds: 1, cancelIf: () => isLost },
          recover: { seconds: 1 },
          onCancel: () => [mark('withdraw')],
        },
        release: () => [mark('release')],
        onEnd: (_ctx, outcome) => [mark(`onEnd ${outcome}`)],
      }),
    });

    game.spells.cast(game.a, game.id.tether);
    game.advance(1);
    isLost = true;
    game.advance(1);
    assert.deepEqual(game.log, [
      'start tether@1',
      't1',
      't2',
      'withdraw@1',
      'onEnd cancelled@1',
      'end tether@1 cancelled',
    ]);
  });

  it('beats a channel every `every` seconds, the last on its last step, then recovers', () => {
    const game = timeline({
      beam: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: { seconds: 1, every: 0.5, tick: (ctx) => [mark(`beat ${ctx.elapsed}`)] },
          recover: { seconds: 0.25 },
        },
        release: () => undefined,
      }),
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
      'end beam@1 released',
    ]);
  });

  it('ticks a channel with no beat every step, and catches up a beat shorter than the step', () => {
    const game = timeline({
      stream: spell({
        activation: { kind: 'trigger' },
        timeline: { channel: { seconds: 0.5, tick: () => [mark('tick')] } },
        release: () => undefined,
      }),
      burst: spell({
        activation: { kind: 'trigger' },
        timeline: { channel: { seconds: 1, every: 0.1, tick: () => [mark('pulse')] } },
        release: () => undefined,
      }),
    });

    game.spells.cast(game.a, game.id.stream);
    game.spells.cast(game.a, game.id.burst);
    game.advance(4);
    assert.equal(game.log.filter((line) => line === 'tick@1').length, 2);
    assert.equal(game.log.filter((line) => line === 'pulse@1').length, 10);
  });

  it('breaks a channel whose breakIf holds, and reads the recovery with the outcome known', () => {
    let isOut = false;

    const game = timeline({
      leash: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: { seconds: 5, breakIf: () => isOut },
          recover: { seconds: (ctx) => (ctx.outcome === 'broken' ? 0.5 : 0) },
        },
        release: () => undefined,
      }),
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
    release: () => [mark('release')],
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
        release: () => undefined,
      }),
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

        onEnd: (_ctx, outcome) => [mark(`onEnd ${outcome}`)],
      }),
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
        timeline: { channel: { seconds: 2 }, recover: { seconds: (ctx) => (ctx.outcome === 'blocked' ? 0.5 : 0.25) } },
        release: () => undefined,
      }),
    });

    const handle = game.spells.cast(game.a, game.id.charge).handle;

    game.advance(1);
    assert.equal(game.spells.finish(handle, 'blocked'), true);
    assert.equal(game.spells.get(handle)?.stage, 'recover');
    assert.equal(game.spells.finish(handle, 'blocked'), false);
    game.advance(2);
    assert.equal(game.log.at(-1), 'end charge@1 blocked');
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
            tick: (ctx) => [run('follow', () => game0.spells.cast(ctx.caster, game0.id.follow))],
          },
        },
        release: () => undefined,
      }),
      follow: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 0.25 } },
        release: () => undefined,
      }),
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
        release: () => undefined,
      }),
    });

    for (let i = 0; i < 20; i++) {
      game.spells.cast(game.a, game.id.loop);
      game.advance(2);
    }

    assert.equal(game.spells.pool.created, 1);
    assert.equal(game.spells.pool.live, 0);
  });
});
