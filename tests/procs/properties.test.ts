import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { grant } from '../../src/procs/index.ts';
import { aura, type Game, makeGame, scripted } from '../helpers/trigger-game.ts';

/** The odds a generated proc carries: absent, certain, never, or a real roll. */
const chances = fc.constantFrom(undefined, 1, 2, 0, -0.5, 0.25, 0.5, 0.75);

describe('chance invariants (fast-check)', () => {
  it('draw once per proc with 0 < chance < 1, in order, and apply exactly those drawing below their chance', () => {
    fc.assert(
      fc.property(
        fc.array(chances, { maxLength: 24 }),
        fc.array(fc.double({ min: 0, max: 0.999_999, noNaN: true }), { maxLength: 24 }),
        (odds, draws) => {
          const random = scripted(draws);
          const { procs, unit, log } = makeGame({ idle: aura({ duration: 1 }) }, { procs: { random } });
          const list = odds.map((chance, index) => grant<Game>('gold', index, chance === undefined ? {} : { chance }));
          const expected: string[] = [];
          let drawn = 0;

          for (const [index, chance] of odds.entries()) {
            const isRolled = chance !== undefined && chance > 0 && chance < 1;
            const draw = isRolled ? (draws[drawn] ?? 0.5) : 0;

            drawn += isRolled ? 1 : 0;

            if (chance === undefined || chance >= 1 || (isRolled && draw < chance)) {
              expected.push(`grant 0x${index}@1`);
            }
          }

          const went = procs.run(list, { self: unit(1) });

          assert.equal(random.count(), drawn);
          assert.deepEqual(log, expected);
          assert.equal(went, expected.length);
        },
      ),
    );
  });
});
