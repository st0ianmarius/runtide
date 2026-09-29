import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { DAMAGE_STAGES, type DamageStage } from '../../src/damage/index.ts';
import { aura, BLOCK, type Game, makeDamageGame } from '../helpers/damage-game.ts';

/** An absorb that keeps its aura when emptied, so its value can be read afterwards. */
const absorb = () =>
  aura({
    duration: 'infinite',
    keepWhenDepleted: true,
    onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) }),
  });

/** Three absorbs, spent in this order. */
const ABSORBS = { first: absorb(), second: absorb(), third: absorb() };

/** A blow amount: whole or fractional, from tiny to overkill. */
const AMOUNT = fc.double({ min: 0.001, max: 400, noNaN: true });

describe('absorbs, for any blow and any shells', () => {
  it('never go negative, spend exactly what they absorb, and leave the rest for health', () => {
    fc.assert(
      fc.property(
        AMOUNT,
        fc.array(fc.double({ min: 0, max: 200, noNaN: true }), { minLength: 3, maxLength: 3 }),
        (amount, values) => {
          const game = makeDamageGame(ABSORBS);
          const target = game.unit(1);
          const names = ['first', 'second', 'third'] as const;

          target.hp = 1000;
          names.forEach((name, index) => game.auras.apply(target, { aura: game.id[name], value: values[index] ?? 0 }));

          const before = names.map((name) => game.auras.find(target, game.id[name])?.value ?? 0);
          const blow = game.damage.hit({ target, amount, kind: game.damage.kinds.id.fire });
          const after = names.map((name) => game.auras.find(target, game.id[name])?.value ?? 0);
          const spent = before.reduce((sum, value, index) => sum + (value - (after[index] ?? 0)), 0);

          assert.ok(after.every((value) => value >= 0));
          assert.ok(blow.absorbed >= 0 && blow.absorbed <= amount);
          assert.ok(Math.abs(spent - blow.absorbed) <= 1e-9 * amount);
          assert.ok(Math.abs(blow.amount + blow.absorbed - amount) <= 1e-9 * amount);
          assert.equal(target.hp, 1000 - blow.amount);
          assert.equal(blow.status, blow.amount === 0 ? 'absorbed' : 'landed');
        },
      ),
    );
  });
});

describe('true damage, for any defence', () => {
  it('skips the block roll, the mitigation rows and absorbs, and takes its whole amount from health', () => {
    fc.assert(
      fc.property(
        AMOUNT,
        fc.record({
          armor: fc.integer({ min: -100, max: 500 }),
          taken: fc.double({ min: 0, max: 3, noNaN: true }),
          shell: fc.nat(100),
        }),
        (amount, defence) => {
          const game = makeDamageGame(ABSORBS, { rolls: BLOCK });
          const target = game.unit(1);

          game.set(target, 'armor', defence.armor);
          game.set(target, 'taken', defence.taken);
          game.set(target, 'blockChance', 0.5);
          game.auras.apply(target, { aura: game.id.first, value: defence.shell });

          const blow = game.damage.hit({ target, amount, kind: game.damage.kinds.id.pure });

          assert.equal(blow.amount, amount);
          assert.equal(target.hp, 100 - amount);
          assert.equal(game.auras.find(target, game.id.first)?.value, defence.shell);
          assert.deepEqual(
            game.log.filter((line) => line.startsWith('roll')),
            [],
          );
        },
      ),
    );
  });
});

describe('armor, for any rating at or above zero', () => {
  it('never raises a blow, and more of it never lets more through', () => {
    fc.assert(
      fc.property(AMOUNT, fc.nat(1000), fc.nat(1000), (amount, low, extra) => {
        const game = makeDamageGame({});
        const [a, b] = [game.unit(1), game.unit(2)];

        a.hp = 1000;
        b.hp = 1000;
        game.set(a, 'armor', low);
        game.set(b, 'armor', low + extra);

        const lighter = game.damage.hit({ target: a, amount }).amount;
        const heavier = game.damage.hit({ target: b, amount }).amount;

        assert.ok(lighter <= amount);
        assert.ok(heavier <= lighter);
      }),
    );
  });
});

describe('game stage positions, for any declarations', () => {
  it('keep the built-in order and put each stage right where it asked', () => {
    const noop: DamageStage<Game> = () => undefined;
    const anchors = DAMAGE_STAGES.filter((name) => name !== 'death');

    fc.assert(
      fc.property(
        fc.array(fc.record({ side: fc.constantFrom('before', 'after'), anchor: fc.constantFrom(...anchors) }), {
          maxLength: 8,
        }),
        (specs) => {
          const stages = Object.fromEntries(
            specs.map((spec, index) => [
              `game${index}`,
              spec.side === 'before' ? { before: spec.anchor, run: noop } : { after: spec.anchor, run: noop },
            ]),
          );

          const order = makeDamageGame({}, { stages }).damage.stages;

          assert.deepEqual(
            order.filter((name) => !name.startsWith('game')),
            [...DAMAGE_STAGES],
          );

          specs.forEach((spec, index) => {
            const at = order.indexOf(`game${index}`);
            const anchor = order.indexOf(spec.anchor);

            assert.ok(spec.side === 'before' ? at < anchor : at > anchor);
          });
        },
      ),
    );
  });
});
