import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { timeLeft } from '../../src/procs/index.ts';
import { explainSpell, rescaleClocks } from '../../src/spells/index.ts';
import { type AbilityGame, auraNamed, makeAbilityGame } from '../helpers/ability-game.ts';
import { aura, type Game, makeSpellGame, mark, spell, SPELL_TAGS, type SpellGame } from '../helpers/spell-game.ts';

describe('a spell’s cooldowns', () => {
  /** A game with a spell on its own cooldown and a global one, and another on the global one landing at release. */
  const cooldownGame = () =>
    makeSpellGame(
      {
        bolt: spell({
          activation: { kind: 'trigger' },
          stats: { cooldown: 2 },
          cooldown: [
            { aura: 'boltCooldown', seconds: (ctx) => ctx.stats.cooldown },
            { aura: 'global', seconds: 0.5 }
          ],
          release: () => [mark('bolt')]
        }),
        slam: spell({
          activation: { kind: 'trigger' },
          timeline: { windup: { seconds: 0.5 } },
          cooldown: { aura: 'global', seconds: 1, startsOn: 'release' },
          release: () => [mark('slam')]
        })
      },
      { auras: { boltCooldown: aura({ duration: 9 }), global: aura({ duration: 9 }) } }
    );

  it('land in order as the cast starts, share an aura across spells, and one lands at the release instead', () => {
    const game = cooldownGame();
    const hero = game.unit(1);

    game.spells.cast(hero, game.id.bolt);
    assert.deepEqual(
      [game.spells.cooldownLeft(hero, game.id.bolt), game.spells.check(hero, game.id.slam)],
      [2, 'cooldown']
    );
    assert.deepEqual(game.spells.cooldownsOf(game.id.bolt), [game.auraId.boltCooldown, game.auraId.global]);

    const other = game.unit(2);

    game.spells.cast(other, game.id.slam);
    assert.equal(game.spells.isCooling(other, game.id.bolt), false);
    for (let i = 0; i < 2; i++) {
      game.step();
      game.spells.step(other);
    }

    assert.equal(game.spells.isCooling(other, game.id.bolt), true);
    assert.equal(game.spells.cooldownLeft(other, game.id.slam), 1);
  });

  it('predict a cast’s cooldowns: those that start on the release that much later, by the windup', () => {
    const game = cooldownGame();
    const hero = game.unit(1);

    game.spells.predictCooldowns(hero, game.id.slam);
    assert.equal(game.spells.cooldownLeft(hero, game.id.slam), 1.5);
    game.spells.predictCooldowns(hero, game.id.bolt);
    assert.equal(game.spells.cooldownLeft(hero, game.id.bolt), 2);
  });

  it('predict nothing for a release cooldown read as 0, as the release lands nothing', () => {
    const game = makeSpellGame(
      {
        slam: spell({
          activation: { kind: 'trigger' },
          timeline: { windup: { seconds: 1 } },
          cooldown: { aura: 'slamCooldown', seconds: () => 0, startsOn: 'release' },
          release: () => undefined
        })
      },
      { auras: { slamCooldown: aura({ duration: 5 }) } }
    );

    const hero = game.unit(1);

    game.spells.predictCooldowns(hero, game.id.slam);
    assert.equal(game.spells.isCooling(hero, game.id.slam), false);
  });

  it('hold a spell only once every charge is spent, each recharging on its own clock', () => {
    const game = makeSpellGame(
      {
        dash: spell({
          activation: { kind: 'trigger' },
          cooldown: { aura: 'dashCharge', seconds: 1, charges: 2 },
          release: () => undefined
        })
      },
      { auras: { dashCharge: aura({ duration: 9, stacking: 'independent', maxStacks: 2 }) } }
    );

    const hero = game.unit(1);

    game.spells.cast(hero, game.id.dash);
    assert.deepEqual(
      [game.spells.isCooling(hero, game.id.dash), game.spells.cooldownLeft(hero, game.id.dash)],
      [false, 0]
    );
    game.spells.cast(hero, game.id.dash);
    assert.deepEqual(
      [game.spells.check(hero, game.id.dash), game.spells.cooldownLeft(hero, game.id.dash)],
      ['cooldown', 1]
    );

    const other = game.unit(2);

    game.spells.cast(other, game.id.dash);

    for (let i = 0; i < 2; i++) {
      game.step();
      game.auras.tick(other, 'world');
    }

    game.spells.cast(other, game.id.dash);
    assert.equal(game.spells.cooldownLeft(other, game.id.dash), 1 - 2 * game.clock.dt);
    assert.throws(
      () =>
        makeSpellGame(
          {
            bad: spell({
              activation: { kind: 'trigger' },
              cooldown: { aura: 'x', charges: 0 },
              release: () => undefined
            })
          },
          { auras: { x: aura({ duration: 1 }) } }
        ),
      /charges are a whole number from 1/
    );
  });

  it('read a caster’s charges at each check, so an item’s extra charge counts at once', () => {
    const extra = new Map<number, number>();

    const game = makeSpellGame(
      {
        dash: spell({
          activation: { kind: 'trigger' },
          cooldown: { aura: 'dashCharge', seconds: 1, charges: (caster) => 1 + (extra.get(caster.id) ?? 0) },
          release: () => undefined
        })
      },
      { auras: { dashCharge: aura({ duration: 9, stacking: 'independent', maxStacks: 3 }) } }
    );

    const hero = game.unit(1);

    game.spells.cast(hero, game.id.dash);
    assert.equal(game.spells.check(hero, game.id.dash), 'cooldown');
    extra.set(hero.id, 1);
    assert.equal(game.spells.check(hero, game.id.dash), undefined);
    game.spells.cast(hero, game.id.dash);
    assert.equal(game.spells.check(hero, game.id.dash), 'cooldown');
    assert.equal(explainSpell(game.spells.registry, game.id.dash).cooldowns[0]?.charges, 'caster');
    extra.set(hero.id, -1);
    assert.throws(() => game.spells.check(hero, game.id.dash), /charges are a whole number from 1; got 0/);
  });

  it('land none for a cooldown reduced to nothing', () => {
    const game = makeSpellGame(
      {
        zap: spell({
          activation: { kind: 'trigger' },
          cooldown: { aura: 'zapCooldown', seconds: 0 },
          release: () => undefined
        })
      },
      { auras: { zapCooldown: aura({ duration: 9 }) } }
    );

    const hero = game.unit(1);

    game.spells.cast(hero, game.id.zap);
    assert.equal(game.spells.isCooling(hero, game.id.zap), false);
  });

  it('let a cooldown aura cancel its cast, which then neither releases nor runs on, at the start or the release', () => {
    const late: { game?: SpellGame<'zap' | 'slam' | 'lob', 'stop'> } = {};

    const hooks = {
      release: () => [mark('release')],
      onEnd: (_ctx: unknown, outcome: string) => [mark(`end ${outcome}`)]
    };

    const game = makeSpellGame(
      {
        zap: spell({ ...hooks, activation: { kind: 'trigger' }, cooldown: { aura: 'stop', seconds: 1 } }),
        slam: spell({
          ...hooks,
          activation: { kind: 'trigger' },
          timeline: { windup: { seconds: 0.5 } },
          cooldown: { aura: 'stop', seconds: 1 }
        }),
        lob: spell({
          ...hooks,
          activation: { kind: 'trigger' },
          timeline: { windup: { seconds: 0.5 } },
          cooldown: { aura: 'stop', seconds: 1, startsOn: 'release' }
        })
      },
      {
        auras: {
          stop: aura({
            duration: 9,

            onApplied: (ctx) => {
              late.game?.spells.cancelAll(ctx.bearer);

              return undefined;
            }
          })
        }
      }
    );

    late.game = game;

    for (const [name, id] of [
      ['zap', 1],
      ['slam', 2],
      ['lob', 3]
    ] as const) {
      const hero = game.unit(id);
      const { handle, status } = game.spells.cast(hero, game.id[name]);

      for (let i = 0; i < 3; i++) {
        game.step();
        game.spells.step(hero);
      }

      assert.deepEqual([status === 'ended', game.spells.isRunning(handle)], [name !== 'lob', false], name);
      assert.equal(game.spells.isCasting(hero), false, name);
      assert.deepEqual(
        game.log.filter((line) => line.endsWith(`@${id}`) && !line.startsWith(`start`)),
        [`end cancelled@${id}`],
        name
      );
    }
  });

  it('start all at once for a press that commits them, and a committed cast neither asks nor lands them', () => {
    const game = cooldownGame();
    const hero = game.unit(1);

    game.spells.startCooldowns(hero, game.id.slam);
    assert.equal(game.spells.cooldownLeft(hero, game.id.slam), 1);
    assert.equal(game.spells.cast(hero, game.id.slam, { committed: true }).status, 'running');
    for (let i = 0; i < 2; i++) {
      game.step();
      game.spells.step(hero);
    }

    assert.equal(game.spells.cooldownLeft(hero, game.id.slam), 1, 'not landed again at the release');
    assert.deepEqual(
      game.log.filter((line) => line === 'slam@1'),
      ['slam@1']
    );
  });
});

describe('time left on cooldown auras', () => {
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
      procs.apply(timeLeft<AbilityGame>('cooldown.ultimate', { ...options, to: 'self' }), {
        self: hero
      });

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
    swing: spell({
      tags: ['melee'],
      activation: { kind: 'auto', interval: 2 },
      release: () => [mark('swing')]
    }),
    bolt: spell({
      tags: ['fire'],
      activation: { kind: 'auto', interval: 4 },
      release: () => [mark('bolt')]
    }),
    channel: spell({
      tags: ['melee'],
      activation: { kind: 'trigger' },
      timeline: { windup: { seconds: 1 } },
      release: () => undefined
    })
  });

describe('rescaling clocks', () => {
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

  it('rescales from a game hook as it comes, and is the rescaleClocks proc', () => {
    const game = clockGame();
    const hero = game.unit(1);

    game.spells.stepAuto(hero);

    game.spells.rescaleClocks(hero, { factor: 0.75 });
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
