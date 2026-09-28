import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aura, makeGame } from '../helpers/aura-game.ts';

describe('periodic beats (§II.6 A3)', () => {
  it('beats every period after the application, the last on the tick it runs out, before its expiry', () => {
    const ticks: number[] = [];

    const { auras, id, unit, run, log } = makeGame({
      bleed: aura({
        duration: 12,
        stacking: 'stack',
        maxStacks: 5,
        onExpired: () => ['expired'],

        periodic: {
          every: 3,

          onBeat: (ctx) => {
            ticks.push(ctx.bearer.auras.clocks[0] ?? 0);

            return [`bleed×${ctx.aura.stacks}`];
          },
        },
      }),
    });

    const u = unit();

    auras.apply(u, { aura: id.bleed, stacks: 2 });
    run(u, 100);
    assert.deepEqual(ticks, [24, 48, 72, 96]);
    assert.deepEqual(log, ['bleed×2@1', 'bleed×2@1', 'bleed×2@1', 'bleed×2@1', 'expired@1']);
  });

  it('keeps the beat through a refresh', () => {
    let beats = 0;

    const { auras, id, unit, run } = makeGame({
      dot: aura({
        duration: 12,
        stacking: 'refresh',

        periodic: {
          every: 3,

          onBeat: () => {
            beats += 1;

            return undefined;
          },
        },
      }),
    });

    const u = unit();

    auras.apply(u, id.dot);
    run(u, 16);
    auras.apply(u, id.dot);
    run(u, 8);
    assert.equal(beats, 1, 'the first beat still lands 3 s after the first application');
  });

  it('catches up when a period is shorter than a step', () => {
    const perTick: number[] = [];
    let beats = 0;

    const { auras, id, unit } = makeGame({
      rapid: aura({
        duration: 10,

        periodic: {
          every: 0.093_75,

          onBeat: () => {
            beats += 1;

            return undefined;
          },
        },
      }),
    });

    const u = unit();

    auras.apply(u, id.rapid);

    for (let i = 0; i < 3; i++) {
      const before = beats;

      auras.tick(u, 'world');
      perTick.push(beats - before);
    }

    assert.deepEqual(perTick, [1, 1, 2]);
  });

  it('beats on every tick with the step as its weight when the period is 0', () => {
    const weights: number[] = [];

    const { auras, id, unit, run } = makeGame({
      regen: aura({
        duration: 0.5,

        periodic: {
          every: 0,

          onBeat: (_ctx, weight) => {
            weights.push(weight);

            return undefined;
          },
        },
      }),
    });

    const u = unit();

    auras.apply(u, id.regen);
    run(u, 10);
    assert.deepEqual(weights, [0.125, 0.125, 0.125, 0.125]);
  });

  it('skips a due beat its gate closes, and keeps counting', () => {
    const { auras, id, unit, run, log } = makeGame({
      heal: aura({
        duration: 'infinite',
        periodic: { every: 1, when: (ctx) => ctx.bearer.hp >= 50, onBeat: () => ['heal'] },
      }),
    });

    const u = unit();

    auras.apply(u, id.heal);
    run(u, 8);
    u.hp = 10;
    run(u, 8);
    u.hp = 90;
    run(u, 8);
    assert.deepEqual(log, ['heal@1', 'heal@1']);
  });

  it('reads a live period at every beat', () => {
    const ticks: number[] = [];

    const { auras, id, unit, run } = makeGame({
      quickening: aura({
        duration: 'infinite',
        value: 2,

        periodic: {
          every: (ctx) => ctx.aura.value,

          onBeat: (ctx) => {
            ticks.push(ctx.bearer.auras.clocks[0] ?? 0);

            return undefined;
          },
        },
      }),
    });

    const u = unit();

    auras.apply(u, id.quickening);
    run(u, 16);
    auras.apply(u, { aura: id.quickening, value: 1 });
    run(u, 32);
    assert.deepEqual(ticks, [16, 32, 40, 48], 'the period after each beat is read as it fires');
  });

  it('counts on a beat clock of its own, independent of the lifetime clock', () => {
    const { auras, id, unit, run, log } = makeGame({
      storm: aura({
        duration: 1,
        clock: 'motion',
        periodic: { every: 0.25, clock: 'world', onBeat: () => ['strike'] },
      }),
    });

    const u = unit();

    auras.apply(u, id.storm);
    run(u, 8);
    assert.deepEqual(log.length, 4, 'four world beats while the motion clock stood still');
    run(u, 8, 'motion');
    assert.equal(auras.has(u, id.storm), false);
  });

  it('runs no beat on a silent bearer, which still counts and expires', () => {
    const { auras, id, unit, run, log } = makeGame({
      dot: aura({ duration: 1, periodic: { every: 0.25, onBeat: () => ['tick'] } }),
    });

    const u = unit(1, true);

    auras.apply(u, id.dot);
    run(u, 8);
    assert.deepEqual(log, []);
    assert.equal(auras.has(u, id.dot), false);
  });

  it('refuses a live period that is not above 0', () => {
    const { auras, id, unit, run } = makeGame({
      broken: aura({ duration: 5, periodic: { every: () => 0, onBeat: () => undefined } }),
    });

    const u = unit();

    assert.throws(() => {
      auras.apply(u, id.broken);
      run(u, 1);
    }, /more than 0/);
  });
});
