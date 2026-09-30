import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { aura, makeGame, mark, scripted } from '../helpers/trigger-game.ts';

/** Three auras with self and party triggers, in registry order. */
const defs = {
  alpha: aura({
    duration: 9,
    triggers: [
      { on: 'hit', do: [mark('alpha.0')] },
      { on: 'hit', hears: 'party', do: [mark('alpha.1')] }
    ]
  }),
  beta: aura({ duration: 9, triggers: [{ on: 'hit', hears: 'party', do: [mark('beta.0')] }] }),
  gamma: aura({
    duration: 9,
    triggers: [
      { on: 'hit', do: [mark('gamma.0')] },
      { on: 'hit', do: [mark('gamma.1')] }
    ]
  })
} as const;

type Name = keyof typeof defs;

/** Each aura's triggers: label and whether it hears the party. */
const TRIGGERS: Readonly<Record<Name, readonly (readonly [string, boolean])[]>> = {
  alpha: [
    ['alpha.0', false],
    ['alpha.1', true]
  ],
  beta: [['beta.0', true]],
  gamma: [
    ['gamma.0', false],
    ['gamma.1', false]
  ]
};

const ORDER: readonly Name[] = ['alpha', 'beta', 'gamma'];

/** A party: each member's auras, applied in any order. */
const party = fc.array(fc.uniqueArray(fc.constantFrom<Name>(...ORDER)), {
  minLength: 1,
  maxLength: 4
});

describe('dispatch invariants (fast-check)', () => {
  it('fire the owner triggers in aura then authored order, then the other members party triggers in order', () => {
    fc.assert(
      fc.property(party, fc.nat(), (members, pick) => {
        const game = makeGame(defs);
        const units = members.map((_names, index) => game.unit(index + 1));

        for (const [index, names] of members.entries()) {
          for (const name of names) {
            game.auras.apply(units[index] ?? units[0] ?? game.unit(99), game.id[name]);
          }
        }

        const about = pick % units.length;
        const expected: string[] = [];

        const heard = (index: number, isListener: boolean): void => {
          for (const name of ORDER.filter((each) => members[index]?.includes(each) === true)) {
            for (const [label, isParty] of TRIGGERS[name]) {
              if (!isListener || isParty) {
                expected.push(`${label}@${index + 1}`);
              }
            }
          }
        };

        heard(about, false);

        for (const index of units.keys()) {
          if (index !== about) {
            heard(index, true);
          }
        }

        game.hit(units[about] ?? game.unit(99));
        assert.deepEqual(game.log, expected);
      })
    );
  });

  it('roll once per heard trigger whose chance is below 1, on the triggers own stream', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(0.1, 0.5, 0.9, 1, undefined), { minLength: 1, maxLength: 8 }),
        fc.nat({ max: 3 }),
        (odds, hits) => {
          const random = scripted();

          const game = makeGame(
            {
              luck: aura({
                duration: 9,
                triggers: odds.map((chance) => ({
                  on: 'hit' as const,
                  do: [mark('luck')],
                  ...(chance === undefined ? {} : { chance })
                }))
              })
            },
            { triggers: { random } }
          );

          const u = game.unit(1);

          game.auras.apply(u, game.id.luck);

          for (let i = 0; i < hits; i++) {
            game.hit(u);
          }

          assert.equal(random.count(), hits * odds.filter((chance) => chance !== undefined && chance < 1).length);
        }
      )
    );
  });
});
