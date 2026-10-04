import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auraGates, auraStacks } from '../../src/auras/index.ts';
import { defineConditions } from '../../src/conditions/index.ts';
import { createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';
import { checkPredicted } from '../../src/prediction/index.ts';
import { auraNamed, makeAbilityGame, spell } from '../helpers/ability-game.ts';
import { aura, makeGame, TAGS } from '../helpers/aura-game.ts';

/** A game whose auras are read by a press, a motion tag and a motion stat, some of them predicted. */
const setUp = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    armor: { base: 0, kind: 'flat' },
    speed: { base: 6, kind: 'flat' }
  });

  const modifiers = createModifierSystem({
    stats,
    sources: defineSources(['base', 'auras', 'late']),
    stacks: auraStacks,
    held: auraGates
  });

  return makeGame(
    {
      cooldown: aura({ duration: 2, predicted: true }),
      charge: aura({ duration: 'infinite' }),
      root: aura({ duration: 1, tags: ['stun'], predicted: true }),
      snare: aura({ duration: 1, tags: ['stun'] }),
      haste: aura({ duration: 3, modifiers: [mul('speed', 1.3)] }),
      might: aura({ duration: 3, modifiers: [mul('damage', 1.3)] }),
      ghost: aura({ duration: 3, predicted: true }),
      dash: aura({
        duration: 1,
        predicted: true,
        onLand: () => undefined,
        modifiers: [plus('speed', 2)]
      }),
      sprint: aura({
        duration: 1,
        predicted: true,
        modifiers: [mul('speed', 1.5), plus('armor', 3)]
      }),
      halo: aura({ duration: 3, tags: ['boon'] })
    },
    { modifiers, fold: 'auras' }
  );
};

describe('the predicted rule', () => {
  it('finds every aura the mirror reads that is not predicted, and every predicted aura nothing reads', () => {
    const { auras, id } = setUp();

    const report = checkPredicted({
      auras,
      abilities: { mirrorReads: { auras: [id.cooldown, id.charge], tags: [TAGS.id.boon] } },
      motion: { tags: ['stun'], stats: ['speed'] }
    });

    assert.deepEqual(report, {
      unpredicted: [
        { aura: id.charge, reason: 'aura' },
        { aura: id.snare, reason: 'tag' },
        { aura: id.haste, reason: 'stat' },
        { aura: id.halo, reason: 'tag' }
      ],
      unread: [id.ghost],
      unsafe: [],
      unseedable: [id.dash],
      inexact: [id.dash],
      frozen: []
    });
  });

  it('finds predicted auras a seed cannot rebuild, and those a split fold of a motion stat folds inexactly', () => {
    const { auras, id } = setUp();
    const report = checkPredicted({ auras, motion: { stats: ['speed'] } });

    assert.deepEqual([report.unseedable, report.inexact], [[id.dash], [id.dash]]);
  });

  it('holds when everything read is predicted, and refuses a motion tag the game does not have', () => {
    const { auras, id } = setUp();

    assert.deepEqual(checkPredicted({ auras, motion: { auras: [id.cooldown, id.root, id.ghost, id.sprint] } }), {
      unpredicted: [],
      unread: [id.dash],
      unsafe: [],
      unseedable: [id.dash],
      inexact: [],
      frozen: []
    });

    const motion = { tags: ['stun' as const] };

    Reflect.set(motion.tags, 0, 'frozen');
    assert.throws(() => checkPredicted({ auras, motion }), /no aura tag named frozen/);
  });

  it('finds every aura the mirror reads on a clock it does not tick, by id, tag or stat, given its clocks', () => {
    const { auras, id } = makeGame({
      cooldown: aura({ duration: 2, predicted: true }),
      dodge: aura({ duration: 1, clock: 'motion', predicted: true }),
      root: aura({ duration: 1, tags: ['stun'], predicted: true }),
      slide: aura({ duration: 1, tags: ['stun'], clock: 'motion', predicted: true }),
      unread: aura({ duration: 1, predicted: true })
    });

    const motion = { auras: [id.cooldown, id.dodge], tags: ['stun' as const] };

    assert.deepEqual(checkPredicted({ auras, motion: { ...motion, clocks: ['motion'] } }).frozen, [
      id.cooldown,
      id.root
    ]);
    assert.deepEqual(checkPredicted({ auras, motion: { ...motion, clocks: ['world'] } }).frozen, [id.dodge, id.slide]);
    assert.deepEqual(checkPredicted({ auras, motion: { ...motion, clocks: ['world', 'motion'] } }).frozen, []);
    assert.deepEqual(checkPredicted({ auras, motion }).frozen, [], 'nothing is reported without the clocks');

    const clocks = ['motion' as const];

    Reflect.set(clocks, 0, 'astral');
    assert.throws(() => checkPredicted({ auras, motion: { clocks } }), /no aura clock named astral/);
  });
});

describe('mirror-safe conditions on predicted auras', () => {
  it('reports a predicted aura whose modifier waits on a condition the mirror may not evaluate', () => {
    const conditions = defineConditions({
      grounded: { test: () => true, mirrorSafe: true },
      lucky: () => true
    });

    const stats = defineStats({
      damage: { base: 1, kind: 'multiplier' },
      armor: { base: 0, kind: 'flat' },
      speed: { base: 6, kind: 'flat' }
    });

    const modifiers = createModifierSystem({
      stats,
      sources: defineSources(['base', 'auras', 'late']),
      conditions,
      stacks: auraStacks,
      held: auraGates
    });

    /** A speed modifier waiting on a game condition (the test game's types name none, so it is set by hand). */
    const speedWhen = (is: string) => {
      const modifier = mul('speed', 1.2);

      Reflect.set(modifier, 'when', { is });

      return modifier;
    };

    const { auras, id } = makeGame(
      {
        dash: aura({ duration: 1, predicted: true, modifiers: [speedWhen('grounded')] }),
        gamble: aura({ duration: 1, predicted: true, modifiers: [speedWhen('lucky')] }),
        fling: aura({ duration: 1, modifiers: [speedWhen('lucky')] })
      },
      { modifiers, fold: 'auras' }
    );

    const report = checkPredicted({
      auras,
      motion: { stats: ['speed'] },
      conditions: { conditions }
    });

    assert.deepEqual(report.unsafe, [id.gamble]);
    assert.deepEqual(report.unpredicted, [{ aura: id.fling, reason: 'stat' }]);
    assert.deepEqual(checkPredicted({ auras, motion: { stats: ['speed'] } }).unsafe, []);
  });
});

describe('what a press reads (abilities.mirrorReads)', () => {
  it('lists the button spells’ cooldowns, the buttons’ costs and their tags, but not the auras they land', () => {
    const release = (): undefined => undefined;

    const game = makeAbilityGame({
      nova: spell({
        activation: {
          kind: 'button',
          cost: { aura: auraNamed('charge') },
          applies: [auraNamed('sprint')],
          requires: ['stance'],
          resets: ['cooldown.dodge']
        },
        cooldown: { aura: 'skillCooldown', seconds: 4 },
        release
      }),
      bolt: spell({
        activation: { kind: 'trigger' },
        cooldown: { aura: 'ultimateCooldown' },
        release
      })
    });

    const { tags } = game.auras;

    assert.deepEqual(game.abilities.mirrorReads, {
      auras: ['skillCooldown', 'charge'].map(auraNamed),
      tags: [tags.id['cooldown.dodge'], tags.id.stance]
    });
  });
});
