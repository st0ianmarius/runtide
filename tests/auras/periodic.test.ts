import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aura, makeGame } from '../helpers/aura-game.ts';

describe('periodic beats', () => {
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
          }
        }
      })
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
          }
        }
      })
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
          }
        }
      })
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

  it('skips a due beat whose onBeat returns nothing, and keeps counting', () => {
    const { auras, id, unit, run, log } = makeGame({
      heal: aura({
        duration: 'infinite',
        periodic: { every: 1, onBeat: (ctx) => (ctx.bearer.hp >= 50 ? ['heal'] : undefined) }
      })
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
          }
        }
      })
    });

    const u = unit();

    auras.apply(u, id.quickening);
    run(u, 16);
    auras.apply(u, { aura: id.quickening, value: 1 });
    run(u, 32);
    assert.deepEqual(ticks, [16, 32, 40, 48], 'the period after each beat is read as it fires');
  });

  it('runs no beat on a silent bearer, which still counts and expires', () => {
    const { auras, id, unit, run, log } = makeGame({
      dot: aura({ duration: 1, periodic: { every: 0.25, onBeat: () => ['tick'] } })
    });

    const u = unit(1, true);

    auras.apply(u, id.dot);
    run(u, 8);
    assert.deepEqual(log, []);
    assert.equal(auras.has(u, id.dot), false);
  });

  it('refuses a live period that is not above 0', () => {
    const { auras, id, unit, run } = makeGame({
      broken: aura({ duration: 5, periodic: { every: () => 0, onBeat: () => undefined } })
    });

    const u = unit();

    assert.throws(() => {
      auras.apply(u, id.broken);
      run(u, 1);
    }, /broken: a live period must be seconds from 0.001; got 0/);
  });

  it('refuses a period below the floor, a static one at load and a live one at its first beat', () => {
    assert.throws(
      () => makeGame({ hum: aura({ duration: 5, periodic: { every: 1e-4, onBeat: () => undefined } }) }),
      /Aura hum: periodic.every must be seconds from 0.001/
    );

    const { auras, id, unit, run, log } = makeGame({
      hum: aura({ duration: 5, value: 0.25, periodic: { every: (ctx) => ctx.aura.value, onBeat: () => ['hum'] } })
    });

    const u = unit();

    auras.apply(u, id.hum);
    auras.apply(u, { aura: id.hum, value: 1e-4 });
    assert.throws(() => {
      run(u, 2);
    }, /hum: a live period must be seconds from 0.001; got 0.0001/);
    assert.deepEqual(log, ['hum@1'], 'the beat fired before its next period was read');
  });

  it('beats once a tick without catch-up, dropping the rest, and every owed beat with it', () => {
    /** The beats of each of four world ticks of an aura beating four times a step. */
    const perTick = (catchUp?: boolean): number[] => {
      let beats = 0;
      const counts: number[] = [];

      const onBeat = (): undefined => {
        beats += 1;
      };

      const every = 0.125 / 4;

      const { auras, id, unit } = makeGame({
        rapid: aura({
          duration: 'infinite',
          periodic: catchUp === undefined ? { every, onBeat } : { every, catchUp, onBeat }
        })
      });

      const u = unit();

      auras.apply(u, id.rapid);

      for (let i = 0; i < 4; i++) {
        const before = beats;

        auras.tick(u, 'world');
        counts.push(beats - before);
      }

      return counts;
    };

    assert.deepEqual(perTick(false), [1, 1, 1, 1]);
    assert.deepEqual(perTick(), [4, 4, 4, 4]);
    assert.deepEqual(perTick(true), [4, 4, 4, 4]);
  });

  it('beats on its own clock: a motion aura beating on world time beats on world ticks and expires on motion ones', () => {
    const { auras, id, unit, run, log } = makeGame({
      whirl: aura({ duration: 1, clock: 'motion', periodic: { every: 0.25, clock: 'world', onBeat: () => ['whirl'] } })
    });

    const u = unit();

    auras.apply(u, id.whirl);
    run(u, 4, 'motion');
    assert.deepEqual(log, [], 'motion ticks count no beat');
    run(u, 4, 'world');
    assert.deepEqual(log, ['whirl@1', 'whirl@1'], 'a beat every two world ticks');
    run(u, 3, 'motion');
    assert.equal(auras.has(u, id.whirl), true);
    run(u, 1, 'motion');
    assert.equal(auras.has(u, id.whirl), false, 'it runs out on its eighth motion tick');
    run(u, 4, 'world');
    assert.equal(log.length, 2);
  });

  it('never reads a live period on a silent bearer as it ticks', () => {
    let calls = 0;

    const { auras, id, unit, run, log } = makeGame({
      dot: aura({
        duration: 'infinite',

        periodic: {
          every: () => {
            calls += 1;

            return 0.25;
          },

          onBeat: () => ['tick']
        }
      })
    });

    const u = unit(1, true);

    auras.apply(u, id.dot);

    const atApply = calls;

    assert.ok(atApply <= 1, 'at most one read at the application');
    run(u, 8);
    run(u, 8, 'motion');
    assert.deepEqual([calls, log], [atApply, []]);
  });
});
