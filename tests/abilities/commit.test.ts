import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PressRefusal } from '../../src/abilities/index.ts';
import type { Vec2 } from '../../src/math/index.ts';
import type { ButtonActivation } from '../../src/spells/index.ts';
import { type AbilityGame, auraNamed, type Hero, makeAbilityGame, spell } from '../helpers/ability-game.ts';

/** What the tests' hooks saw, as lines. */
const seen: { lines: string[]; pet?: Hero } = { lines: [] };

/** Steps the bearer ten back along x: a dodge away from what it shoots at. */
const backstep: ButtonActivation<AbilityGame>['activate'] = ({ bearer }) => {
  seen.lines.push(`activate ${bearer.id}`);
  bearer.at = { x: bearer.at.x - 10, z: bearer.at.z };
};

/** A ranged shot at the press's aim, five across, that commits as its button says, paying a charge and stepping back. */
const shot = (commitsOn: 'press' | 'cast') =>
  spell({
    activation: { kind: 'button', commitsOn, cost: { aura: auraNamed('charge') }, activate: backstep },
    cooldown: { aura: 'skillCooldown', seconds: 2 },

    target: (_ctx, input: Vec2 | undefined) => {
      seen.lines.push('target');

      return input;
    },

    reach: { range: 5, pointOf: (point: Vec2) => point },

    release: (ctx) => {
      seen.lines.push(`release ${ctx.caster.id} at ${ctx.caster.at.x}`);

      return undefined;
    }
  });

/** A test game: a dodge that pays a charge, a shot that commits on its cast, one that commits at the press. */
const setUp = () => {
  const game = makeAbilityGame({
    spend: spell({
      activation: { kind: 'button', cost: { aura: auraNamed('charge') } },
      release: () => undefined
    }),
    castShot: shot('cast'),
    pressShot: shot('press')
  });

  seen.lines = [];

  return { game, hero: game.hero(1) };
};

describe('a button that commits on its cast', () => {
  it('runs the cast order once, committing inside it, so a dodge out of range still casts', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { skill } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    auras.apply(hero, { aura: auraNamed('charge'), stacks: 2 });
    abilities.equip(hero, skill, game.id.castShot);
    assert.equal(abilities.tryActivate(hero, abilities.bit(skill), { input: { x: 4, z: 0 }, refusals }), 2);
    assert.deepEqual(
      [refusals[skill], auras.stacks(hero, auraNamed('charge')), abilities.cooldownLeft(hero, skill), hero.at.x],
      [undefined, 1, 2, -9]
    );
    assert.deepEqual(seen.lines, ['target', 'activate 1', 'release 1 at -9']);
  });

  it('refuses as `cost` a cost it can no longer pay once admitted, casting nothing and cooling nothing', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { dodge, skill } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    auras.apply(hero, auraNamed('charge'));
    abilities.equip(hero, dodge, game.id.spend);
    abilities.equip(hero, skill, game.id.castShot);
    assert.equal(
      abilities.tryActivate(hero, abilities.bit(dodge) | abilities.bit(skill), { input: { x: 4, z: 0 }, refusals }),
      abilities.bit(dodge)
    );
    assert.deepEqual([refusals[skill], abilities.cooldownLeft(hero, skill), hero.at.x], ['cost', 0, 1]);
    assert.deepEqual(seen.lines, ['target']);
  });

  it('pays nothing and runs no `activate` for a cast its reach refuses', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { skill } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    auras.apply(hero, auraNamed('charge'));
    abilities.equip(hero, skill, game.id.castShot);
    assert.equal(abilities.tryActivate(hero, abilities.bit(skill), { input: { x: 20, z: 0 }, refusals }), 0);
    assert.deepEqual(
      [refusals[skill], auras.stacks(hero, auraNamed('charge')), abilities.cooldownLeft(hero, skill), hero.at.x],
      ['range', 1, 0, 1]
    );
    assert.deepEqual(seen.lines, ['target']);
  });

  it('leaves a button that commits at the press as it was: it pays and moves, then its cast meets the range', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { skill } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    auras.apply(hero, auraNamed('charge'));
    abilities.equip(hero, skill, game.id.pressShot);
    assert.equal(abilities.tryActivate(hero, abilities.bit(skill), { input: { x: 4, z: 0 }, refusals }), 2);
    assert.deepEqual(
      [refusals[skill], auras.stacks(hero, auraNamed('charge')), abilities.cooldownLeft(hero, skill), hero.at.x],
      ['range', 0, 2, -9]
    );
    assert.deepEqual(seen.lines, ['activate 1', 'target']);
  });

  it('gives the outer cast its press back after a press its `activate` made for another bearer', () => {
    const game = makeAbilityGame({
      order: spell({
        ranks: 2,
        activation: {
          kind: 'button',
          commitsOn: 'cast',
          cost: { aura: auraNamed('charge') },

          activate: (ctx) => {
            if (seen.pet !== undefined) {
              game.abilities.tryActivate(seen.pet, game.abilities.bit(game.abilities.slots.id.skill), {
                input: { x: 3, z: 0 }
              });
            }

            seen.lines.push(`activate ${ctx.bearer.id} input ${ctx.input?.x} rank ${ctx.rank}`);
          }
        },
        cooldown: { aura: 'ultimateCooldown', seconds: 3 },

        release: (ctx) => {
          seen.lines.push(`release ${ctx.caster.id} input ${ctx.input?.x} rank ${ctx.rank}`);

          return undefined;
        }
      }),
      castShot: shot('cast')
    });

    const hero = game.hero(1);
    const { abilities, auras } = game;
    const { skill, ultimate } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    seen.lines = [];
    seen.pet = game.hero(2);
    auras.apply(hero, auraNamed('charge'));
    auras.apply(seen.pet, auraNamed('charge'));
    abilities.equip(hero, ultimate, { spell: game.id.order, rank: 2 });
    abilities.equip(seen.pet, skill, game.id.castShot);
    assert.equal(
      abilities.tryActivate(hero, abilities.bit(ultimate), { input: { x: 7, z: 0 }, refusals }),
      abilities.bit(ultimate)
    );
    assert.deepEqual(
      [refusals[ultimate], auras.stacks(hero, auraNamed('charge')), auras.stacks(seen.pet, auraNamed('charge'))],
      [undefined, 0, 0]
    );
    assert.deepEqual([abilities.cooldownLeft(hero, ultimate), abilities.cooldownLeft(seen.pet, skill)], [3, 2]);
    assert.deepEqual(seen.lines, [
      'target',
      'activate 2',
      'release 2 at -8',
      'activate 1 input 7 rank 2',
      'release 1 input 7 rank 2'
    ]);
    delete seen.pet;
  });
});
