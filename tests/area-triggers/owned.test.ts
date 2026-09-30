import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AreaTriggerHandle, despawnOwned, NO_AREA_TRIGGER, spawn } from '../../src/area-triggers/index.ts';
import { circle } from '../../src/math/index.ts';
import { after, castSpell } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell } from '../helpers/spell-game.ts';

/** A game with a telegraph (a pool tagged as such, waiting out a stun), a lingering patch, and a volley spell. */
const owned = () => {
  const game = makeSpellGame(
    {
      volley: spell({
        activation: { kind: 'trigger' },
        release: () => [spawn('telegraph'), spawn('patch'), after(1, [mark('late')])],
      }),
    },
    {
      spells: { interrupts: ['stun'] },
      areaTriggers: {
        telegraph: { tags: ['pool'], shape: circle(1), lifetime: 2, bound: { pausedBy: ['stun'] } },
        patch: { shape: circle(1), lifetime: 2 },
      },
    },
  );

  const elite = game.unit(1);

  game.spells.cast(elite, game.id.volley);

  const tick = () => {
    game.step();
    game.areaTriggers.step();
    game.spells.stepDelayed();
  };

  return { game, elite, tick };
};

describe('an owner’s interrupts pausing its area triggers', () => {
  it('suspend a kind that waits them out while its owner holds one, even once the cast ended', () => {
    const { game, elite, tick } = owned();
    const out: AreaTriggerHandle[] = [];

    game.areaTriggers.query({ tag: 'pool' }, out);

    const telegraph = out[0] ?? NO_AREA_TRIGGER;

    tick();
    game.spells.interrupt(elite, 'stun');
    tick();
    tick();

    const view = game.areaTriggers.get(telegraph);

    assert.equal(view?.isSuspended, true);
    assert.equal(view?.remaining, 1.75);
    game.spells.endInterrupt(elite, 'stun');
    tick();
    assert.equal(game.areaTriggers.get(telegraph)?.isSuspended, false);
    assert.equal(game.areaTriggers.get(telegraph)?.remaining, 1.5);
  });

  it('refuse at load an interrupt the spell system does not know', () => {
    assert.throws(
      () =>
        makeSpellGame(
          {},
          { areaTriggers: { telegraph: { shape: circle(1), lifetime: 2, bound: { pausedBy: ['stun'] } } } },
        ),
      /Interrupt stun is not one the spell system knows/,
    );
  });
});

describe('withdrawing what a unit owns', () => {
  it('withdraws its delayed lists that have not landed, from casts that ended too', () => {
    const { game, elite, tick } = owned();

    assert.equal(game.spells.delayed.pending, 1);
    assert.equal(game.spells.withdrawDelayed(game.unit(2)), 0);
    assert.equal(game.spells.withdrawDelayed(elite), 1);
    tick();
    tick();
    tick();
    tick();
    assert.equal(game.log.includes('late@1'), false);
    assert.equal(game.spells.delayed.pending, 0);
  });

  it('is the despawnOwned proc: tagged area triggers and delayed lists, or area triggers alone', () => {
    const { game, elite } = owned();
    const outcome = game.procs.apply(despawnOwned({ tag: 'pool' }), { self: elite });

    assert.deepEqual([outcome.status, outcome.amount], ['landed', 2]);
    assert.equal(game.areaTriggers.query({ owner: elite }, []), 1);
    assert.equal(game.log.includes('ended telegraph@1 self'), true);
    assert.equal(game.procs.apply(despawnOwned({ delayed: 'keep', reason: 'bound' }), { self: elite }).amount, 1);
    assert.equal(game.log.includes('ended patch@1 bound'), true);
    assert.equal(game.procs.apply(despawnOwned(), { self: elite }).status, 'skipped');

    const forged = despawnOwned<Game>({ tag: 'pool' });

    Reflect.set(forged, 'tag', 'wall');
    assert.throws(() => game.procs.prepare([forged], 'Test'), /unknown area trigger tag wall/);
  });

  it("ends them for the game's own reasons, the registry's after the framework's, and refuses unknown ones", () => {
    const { game, elite } = owned();
    const { registry } = game.areaTriggers;

    assert.deepEqual(registry.endReasons.slice(-2), ['source-gone', 'phase']);
    assert.equal(game.procs.apply(despawnOwned({ tag: 'pool', reason: 'phase' }), { self: elite }).amount, 2);
    assert.equal(game.log.includes('ended telegraph@1 phase'), true);

    const forged = despawnOwned<Game>({ reason: 'phase' });

    Reflect.set(forged, 'reason', 'storm');
    assert.throws(() => game.procs.prepare([forged], 'Test'), /unknown end reason storm/);
    assert.throws(
      () => Reflect.apply(game.areaTriggers.despawnWhere, undefined, [{ owner: elite }, 'storm']),
      /unknown end reason storm/,
    );
  });

  it('withdraws from a cast chain as it runs, not the list landing now', () => {
    const game = makeSpellGame({
      chain: spell({
        activation: { kind: 'trigger' },
        release: () => [after(0.25, [despawnOwned<Game>(), mark('landed')]), after(0.5, [mark('never')])],
      }),
      other: spell({ activation: { kind: 'trigger' }, release: () => [castSpell('chain')] }),
    });

    const elite = game.unit(1);

    game.spells.cast(elite, game.id.other);

    for (let i = 0; i < 4; i++) {
      game.step();
      game.spells.stepDelayed();
    }

    assert.equal(game.log.includes('landed@1'), true);
    assert.equal(game.log.includes('never@1'), false);
    assert.equal(game.spells.delayed.pending, 0);
  });
});
