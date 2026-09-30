import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ClockRescale } from '../../src/auras/index.ts';
import { timeLeft } from '../../src/procs/index.ts';
import { rescaleClocks } from '../../src/spells/index.ts';
import { type AbilityGame, auraNamed, makeAbilityGame } from '../helpers/ability-game.ts';
import { type Game, makeSpellGame, mark, spell, SPELL_TAGS, STATS } from '../helpers/spell-game.ts';

describe('time left on cooldown auras (§II.6 P3, §I.7.1 F15)', () => {
  it('scales and caps what is left of every aura with a tag, keeping its duration', () => {
    const game = makeAbilityGame({});
    const { auras } = game;
    const hero = game.hero(1);
    const tags = auras.tags.id;

    auras.apply(hero, { aura: auraNamed('dodgeCooldown'), duration: 4 });
    auras.apply(hero, { aura: auraNamed('skillCooldown'), duration: 8 });
    auras.apply(hero, auraNamed('stance'));

    assert.equal(auras.scaleTimeLeft(hero, tags['cooldown.dodge'], 0.5), 1);
    assert.equal(auras.remaining(hero, auraNamed('dodgeCooldown')), 2);
    assert.equal(auras.find(hero, auraNamed('dodgeCooldown'))?.duration, 4);
    assert.equal(auras.clampTimeLeft(hero, tags['cooldown.skill'], 3), 1);
    assert.equal(auras.remaining(hero, auraNamed('skillCooldown')), 3);
    assert.equal(auras.clampTimeLeft(hero, tags['cooldown.skill'], 5), 0);
    assert.equal(auras.scaleTimeLeft(hero, tags.stance, 0), 0);
    assert.throws(() => auras.scaleTimeLeft(hero, tags.stance, -1), /factor and a cap from 0/);
  });

  it('runs a cooldown refunded to nothing out on the next tick', () => {
    const game = makeAbilityGame({});
    const hero = game.hero(1);

    game.auras.apply(hero, { aura: auraNamed('dodgeCooldown'), duration: 4 });
    game.auras.scaleTimeLeft(hero, game.auras.tags.id['cooldown.dodge'], 0);
    assert.equal(game.auras.has(hero, auraNamed('dodgeCooldown')), true);
    game.step();
    assert.equal(game.auras.has(hero, auraNamed('dodgeCooldown')), false);
  });

  it('is the timeLeft proc: a factor, a cap, or both, skipped when nothing changed', () => {
    const game = makeAbilityGame({});
    const { procs, auras } = game;
    const hero = game.hero(1);

    auras.apply(hero, { aura: auraNamed('ultimateCooldown'), duration: 10 });

    const apply = (options: { readonly factor?: number; readonly max?: number }) =>
      procs.apply(timeLeft<AbilityGame>('cooldown.ultimate', { ...options, to: 'self' }), { self: hero });

    assert.equal(apply({ factor: 0.8 }).status, 'landed');
    assert.equal(auras.remaining(hero, auraNamed('ultimateCooldown')), 8);
    assert.equal(apply({ max: 5 }).amount, 1);
    assert.equal(auras.remaining(hero, auraNamed('ultimateCooldown')), 5);
    assert.equal(apply({ max: 6 }).status, 'skipped');
    assert.throws(() => procs.prepare([timeLeft<AbilityGame>('cooldown.ultimate', { factor: -1 })], 'Test'), /factor/);
  });
});

/** A game with an attack clock tagged melee, a fire bolt clock, and a channel. */
const clockGame = () =>
  makeSpellGame({
    swing: spell({ tags: ['melee'], activation: { kind: 'auto', interval: 2 }, release: () => [mark('swing')] }),
    bolt: spell({ tags: ['fire'], activation: { kind: 'auto', interval: 4 }, release: () => [mark('bolt')] }),
    channel: spell({
      tags: ['melee'],
      activation: { kind: 'trigger' },
      timeline: { windup: { seconds: 1 } },
      release: () => undefined,
    }),
  });

describe('rescaling clocks (§II.6 A13, §I.7.1 F15)', () => {
  it('rescales the auto clocks still counting in a tag’s scope, or every one', () => {
    const game = clockGame();
    const hero = game.unit(1);

    game.spells.stepAuto(hero);
    assert.deepEqual([game.spells.autoClock(hero, game.id.swing), game.spells.autoClock(hero, game.id.bolt)], [2, 4]);
    assert.equal(game.spells.rescaleClocks(hero, { factor: 0.5, tag: SPELL_TAGS.id.melee }), 1);
    assert.deepEqual([game.spells.autoClock(hero, game.id.swing), game.spells.autoClock(hero, game.id.bolt)], [1, 4]);
    assert.equal(game.spells.rescaleClocks(hero, { factor: 2 }), 2);
    assert.deepEqual([game.spells.autoClock(hero, game.id.swing), game.spells.autoClock(hero, game.id.bolt)], [2, 8]);
    assert.throws(() => game.spells.rescaleClocks(hero, { factor: Number.NaN }), /finite factor from 0/);
  });

  it('rescales running casts’ stages only when asked for every clock', () => {
    const game = clockGame();
    const hero = game.unit(1);
    const { handle } = game.spells.cast(hero, game.id.channel);

    game.spells.rescaleClocks(hero, { factor: 0.5 });
    assert.equal(game.spells.viewOf(handle)?.end, 4);
    game.spells.rescaleClocks(hero, { factor: 0.5, clocks: 'all' });
    assert.equal(game.spells.viewOf(handle)?.end, 2);
  });

  it('takes an aura system’s rescale as it comes (a ClockRescale), and is the rescaleClocks proc', () => {
    const game = clockGame();
    const hero = game.unit(1);

    game.spells.stepAuto(hero);

    const fromAura: ClockRescale = {
      aura: auraNamed('stance'),
      stat: STATS.id.power,
      factor: 0.75,
      tag: -1,
      clocks: 'pending',
    };

    game.spells.rescaleClocks(hero, fromAura);
    assert.equal(game.spells.autoClock(hero, game.id.bolt), 3);

    const proc = rescaleClocks<Game>(2, { tag: 'fire' });

    assert.equal(game.procs.apply(proc, { self: hero }).status, 'landed');
    assert.equal(game.spells.autoClock(hero, game.id.bolt), 6);
    assert.equal(game.spells.autoClock(hero, game.id.swing), 1.5);

    const frost = rescaleClocks<Game>(1, { tag: 'fire' });

    Reflect.set(frost, 'tag', 'frost');
    assert.throws(() => game.procs.prepare([frost], 'Test'), /spell tag frost/);
  });
});
