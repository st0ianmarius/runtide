import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auraStacks } from '../../src/auras/index.ts';
import { createModifierSystem, defineSources, defineStats, mul } from '../../src/modifiers/index.ts';
import { checkPredicted } from '../../src/prediction/index.ts';
import { auraNamed, makeAbilityGame, spell } from '../helpers/ability-game.ts';
import { aura, makeGame, TAGS } from '../helpers/aura-game.ts';

/** A game whose auras are read by a press, a motion tag and a motion stat, some of them predicted. */
const setUp = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    armor: { base: 0, kind: 'flat' },
    speed: { base: 6, kind: 'flat' },
  });

  const modifiers = createModifierSystem({
    stats,
    sources: defineSources(['base', 'auras', 'late']),
    stacks: auraStacks,
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
      halo: aura({ duration: 3, tags: ['boon'] }),
    },
    { modifiers, fold: 'auras' },
  );
};

describe('the predicted rule (§II.6 P7, R3)', () => {
  it('finds every aura the mirror reads that is not predicted, and every predicted aura nothing reads', () => {
    const { auras, id } = setUp();

    const report = checkPredicted({
      auras,
      abilities: { mirrorReads: { auras: [id.cooldown, id.charge], tags: [TAGS.id.boon] } },
      motion: { tags: ['stun'], stats: ['speed'] },
    });

    assert.deepEqual(report, {
      unpredicted: [
        { aura: id.charge, reason: 'aura' },
        { aura: id.snare, reason: 'tag' },
        { aura: id.haste, reason: 'stat' },
        { aura: id.halo, reason: 'tag' },
      ],
      unread: [id.ghost],
    });
  });

  it('holds when everything read is predicted, and refuses a motion tag the game does not have', () => {
    const { auras, id } = setUp();

    assert.deepEqual(checkPredicted({ auras, motion: { auras: [id.cooldown, id.root, id.ghost] } }), {
      unpredicted: [],
      unread: [],
    });

    const motion = { tags: ['stun' as const] };

    Reflect.set(motion.tags, 0, 'frozen');
    assert.throws(() => checkPredicted({ auras, motion }), /no aura tag named frozen/);
  });
});

describe('what a press reads (abilities.mirrorReads)', () => {
  it('lists the slots’ cooldowns, the buttons’ costs and applied auras, and their tags', () => {
    const release = (): undefined => undefined;

    const game = makeAbilityGame({
      nova: spell({
        activation: {
          kind: 'button',
          cost: { aura: auraNamed('charge') },
          applies: [{ aura: auraNamed('sprint') }],
          requires: ['stance'],
          resets: ['cooldown.dodge'],
        },
        release,
      }),
    });

    const { tags } = game.auras;

    assert.deepEqual(game.abilities.mirrorReads, {
      auras: ['dodgeCooldown', 'skillCooldown', 'ultimateCooldown', 'charge', 'sprint'].map(auraNamed),
      tags: [tags.id['cooldown.dodge'], tags.id.stance],
    });
  });
});
