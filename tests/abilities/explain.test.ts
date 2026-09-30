import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auraNamed, makeAbilityGame, spell } from '../helpers/ability-game.ts';

/** A release that does nothing. */
const release = (): undefined => undefined;

/** A test game over a button with every rule, a plain one, and a spell that is not a button. */
const setUp = () =>
  makeAbilityGame({
    nova: spell({
      activation: {
        kind: 'button',
        commitsOn: 'cast',
        cost: { aura: 'charge', stacks: 2 },
        requires: ['stance'],
        blockedBy: ['rooted'],
        resets: ['cooldown.dodge'],
        applies: [auraNamed('sprint'), auraNamed('stance')]
      },
      release
    }),

    free: spell({ activation: { kind: 'button' }, release }),
    swing: spell({ activation: { kind: 'trigger' }, release })
  });

describe('button explanations', () => {
  it('give a button’s rules as ids', () => {
    const game = setUp();
    const { abilities, auras, id } = game;

    assert.deepEqual(abilities.explain(id.nova), {
      kind: 'button',
      commitsOn: 'cast',
      cost: { aura: auraNamed('charge'), stacks: 2 },
      requires: [auras.tags.id.stance],
      blockedBy: [auras.tags.id.rooted],
      resets: [auras.tags.id['cooldown.dodge']],
      applies: [auraNamed('sprint'), auraNamed('stance')]
    });
  });

  it('commit at the press by default, and give nothing for a spell that is not a button', () => {
    const game = setUp();
    const { abilities, id } = game;

    assert.equal(abilities.explain(id.free)?.commitsOn, 'press');
    assert.equal(abilities.explain(id.free)?.cost, undefined);
    assert.equal(abilities.explain(id.swing), undefined);
  });
});
