import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraContext } from '../../src/auras/index.ts';
import { setHealth } from '../../src/damage/index.ts';
import { aura, type DamageOverrides, type Game, makeDamageGame } from '../helpers/damage-game.ts';

/** The names of the auras whose `onLethal` hook answered, in order; cleared by each test. */
const SEEN: string[] = [];

/** A death escape that notes its name and prevents the death, leaving the bearer at 30% health. */
const escape = (name: string, lethalOrder?: number) =>
  aura({
    duration: 10,
    ...(lethalOrder === undefined ? {} : { lethalOrder }),

    onLethal: (_ctx: AuraContext<Game>) => {
      SEEN.push(name);

      return { prevent: true, procs: [setHealth({ share: 0.3 })] };
    }
  });

/** A game stage between `lethal` and `health` that adds 100 damage to every blow. */
const CRUSH: DamageOverrides = {
  stages: {
    crush: {
      before: 'health',

      run: (blow) => {
        blow.amount += 100;

        return undefined;
      }
    }
  }
};

describe('the order of the lethal hooks', () => {
  it('walks them by their lethalOrder, lower first, whatever their ids, then registry order', () => {
    SEEN.length = 0;

    const { damage, auras, id, unit } = makeDamageGame({
      late: escape('late', 1),
      early: escape('early', -1),
      plain: escape('plain')
    });

    const [target, other] = [unit(1), unit(2)];

    auras.apply(target, id.late);
    auras.apply(target, id.plain);
    auras.apply(target, id.early);
    assert.equal(damage.hit({ target, amount: 500 }).isDeathPrevented, true);

    auras.apply(other, id.late);
    auras.apply(other, id.plain);
    damage.hit({ target: other, amount: 500 });

    assert.deepEqual(SEEN, ['early', 'plain']);
    assert.equal(target.hp, 30);
    assert.throws(() => makeDamageGame({ bad: aura({ duration: 1, lethalOrder: Infinity }) }), /lethalOrder/);
  });
});

describe('a game stage between lethal and health', () => {
  it('that makes a blow lethal has the health stage walk the onLethal hooks the lethal stage did not', () => {
    SEEN.length = 0;

    const { damage, auras, id, unit } = makeDamageGame({ escape: escape('escape') }, CRUSH);
    const target = unit(1);

    auras.apply(target, id.escape);

    const blow = damage.hit({ target, amount: 10 });

    assert.deepEqual([blow.isDeathPrevented, blow.hasKilled, blow.prevented, target.hp], [true, false, 110, 30]);
    assert.deepEqual(SEEN, ['escape']);
  });

  it('walks them once for a blow already lethal at the lethal stage, and not at all for one that bypasses it', () => {
    SEEN.length = 0;

    const pass = aura({
      duration: 10,

      onLethal: () => {
        SEEN.push('pass');

        return undefined;
      }
    });

    const { damage, auras, id, unit } = makeDamageGame({ pass }, CRUSH);

    const [target, other] = [unit(1), unit(2)];

    auras.apply(target, id.pass);
    auras.apply(other, id.pass);
    assert.equal(damage.hit({ target, amount: 500 }).hasKilled, true);
    assert.deepEqual(SEEN, ['pass']);

    assert.equal(damage.hit({ target: other, amount: 10, bypass: ['lethal'] }).hasKilled, true);
    assert.deepEqual(SEEN, ['pass']);
  });
});
