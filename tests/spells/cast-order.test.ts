import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Vec2 } from '../../src/math/index.ts';
import { run } from '../../src/procs/index.ts';
import { type Game, makeSpellGame, mark, spell, type Unit } from '../helpers/spell-game.ts';

/** Aims at the unit it was handed. */
const atInput = (_ctx: unknown, input: Unit | undefined): Unit | undefined => input;

/** A unit's point. */
const pointOfUnit = (target: Unit): Vec2 => target.at;

describe('the release event', () => {
  it('goes out after the release hook’s procs for a plain cast, then the end', () => {
    const game = makeSpellGame({
      bolt: spell({ activation: { kind: 'trigger' }, release: () => [mark('payload')] })
    });

    const report = game.spells.cast(game.unit(1), game.id.bolt);

    assert.equal(report.went, 1);
    assert.deepEqual(game.log, ['start bolt@1', 'payload@1', 'release bolt@1', 'end bolt@1 released']);
  });

  it('goes out for a cast its own release hook finished, before its end, and its procs run after', () => {
    const game = makeSpellGame({
      charge: spell({
        activation: { kind: 'trigger' },

        release: (ctx) => {
          game.spells.finish(ctx.cast, 'blocked');

          return [mark('payload')];
        }
      })
    });

    const report = game.spells.cast(game.unit(1), game.id.charge);

    assert.deepEqual([report.status, report.hasReleased], ['ended', true]);
    assert.ok(report.went > 0);
    assert.deepEqual(game.log, ['start charge@1', 'release charge@1', 'end charge@1 blocked', 'payload@1']);
  });

  it('goes out for a cast whose release procs cancel its caster’s casts', () => {
    const game = makeSpellGame({
      rash: spell({
        activation: { kind: 'trigger' },
        release: () => [run<Game>('die', (ctx) => game.spells.cancelAll(ctx.self)), mark('after')]
      })
    });

    const report = game.spells.cast(game.unit(1), game.id.rash);

    assert.equal(report.status, 'ended');
    assert.ok(report.went > 0);
    assert.deepEqual(game.log, ['start rash@1', 'release rash@1', 'end rash@1 cancelled', 'after@1']);
  });
});

describe('onAdmit', () => {
  it('refuses as gate on false, for the game’s reason on a reason, with no start and no cast', () => {
    const game = makeSpellGame({
      bolt: spell({ activation: { kind: 'trigger' }, begin: () => [mark('begin')], release: () => [mark('payload')] })
    });

    const a = game.unit(1);
    const refused = game.spells.cast(a, game.id.bolt, { onAdmit: () => false });

    assert.deepEqual([refused.status, refused.refusal, refused.went], ['refused', 'gate', 0]);
    assert.equal(game.spells.cast(a, game.id.bolt, { onAdmit: () => 'noRage' }).refusal, 'noRage');
    assert.equal(game.spells.isCasting(a), false);
    assert.deepEqual(game.log, []);
  });

  it('lets the cast begin on true or nothing, asked once, after the cast order and before begin', () => {
    const order: string[] = [];

    const game = makeSpellGame({
      bolt: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 } },
        target: atInput,

        canCast: () => {
          order.push('canCast');

          return true;
        },

        begin: () => {
          order.push('begin');

          return undefined;
        },

        release: () => undefined
      })
    });

    const [a, foe] = [game.unit(1), game.unit(2)];

    const report = game.spells.cast(a, game.id.bolt, {
      input: foe,

      onAdmit: (ctx) => {
        order.push(`onAdmit ${ctx.caster.id}`);

        return true;
      }
    });

    assert.equal(report.status, 'running');
    assert.equal(game.spells.isCasting(a, game.id.bolt), true);
    assert.deepEqual(order, ['canCast', 'onAdmit 1', 'begin']);
    assert.equal(game.spells.cast(a, game.id.bolt, { input: foe, onAdmit: () => undefined }).status, 'running');
  });

  it('is never asked by a check, nor after canCast, the target or the reach refused', () => {
    let asked = 0;

    const onAdmit = () => {
      asked += 1;

      return true;
    };

    const game = makeSpellGame({
      bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined }),
      held: spell({ activation: { kind: 'trigger' }, canCast: () => false, release: () => undefined }),
      aimed: spell({ activation: { kind: 'trigger' }, target: atInput, release: () => undefined }),
      poke: spell({
        activation: { kind: 'trigger' },
        target: atInput,
        reach: { range: 4, pointOf: pointOfUnit },
        release: () => undefined
      })
    });

    const [a, far] = [game.unit(1), game.unit(100)];

    assert.equal(game.spells.check(a, game.id.bolt, { onAdmit }), undefined);
    assert.equal(game.spells.cast(a, game.id.held, { onAdmit }).refusal, 'canCast');
    assert.equal(game.spells.cast(a, game.id.aimed, { onAdmit }).refusal, 'target');
    assert.equal(game.spells.cast(a, game.id.poke, { input: far, onAdmit }).refusal, 'range');
    assert.equal(asked, 0);
  });

  it('may change the world: a cast it starts runs first, and the admitted cast then begins', () => {
    const game = makeSpellGame({
      tap: spell({ activation: { kind: 'trigger' }, release: () => [mark('tap')] }),
      bolt: spell({ activation: { kind: 'trigger' }, release: () => [mark('bolt')] })
    });

    const a = game.unit(1);

    const report = game.spells.cast(a, game.id.bolt, {
      onAdmit: () => game.spells.cast(a, game.id.tap).status === 'ended'
    });

    assert.deepEqual([report.status, report.went], ['ended', 1]);

    assert.deepEqual(game.log, [
      'start tap@1',
      'tap@1',
      'release tap@1',
      'end tap@1 released',
      'start bolt@1',
      'bolt@1',
      'release bolt@1',
      'end bolt@1 released'
    ]);
  });
});

describe('interrupts', () => {
  it('throws for an interrupt the game did not declare and no timeline names', () => {
    const game = makeSpellGame({ bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined }) });
    const a = game.unit(1);

    assert.throws(() => game.spells.interrupt(a, 'stun'), { name: 'RangeError', message: /Interrupt stun/ });
    assert.throws(() => game.spells.endInterrupt(a, 'stun'), { name: 'RangeError', message: /Interrupt stun/ });
    assert.throws(() => game.spells.isInterrupted(a, 'stun'), { name: 'RangeError', message: /Interrupt stun/ });
  });

  it('answers a declared interrupt no spell answers quietly', () => {
    const game = makeSpellGame(
      { bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined }) },
      { spells: { interrupts: ['stun'] } }
    );

    const a = game.unit(1);

    assert.equal(game.spells.isInterrupted(a, 'stun'), false);
    assert.equal(game.spells.interrupt(a, 'stun'), 0);
    assert.equal(game.spells.isInterrupted(a, 'stun'), true);
    assert.equal(game.spells.endInterrupt(a, 'stun'), 0);
    assert.equal(game.spells.isInterrupted(a, 'stun'), false);
  });
});
