import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraSystem } from '../../src/auras/index.ts';
import { haste, ranks, scaled } from '../../src/modifiers/index.ts';
import type { ButtonActivation, SpellContext, StaticWorld } from '../../src/spells/index.ts';
import { type AbilityGame, auraNamed, type Hero, makeAbilityGame, spell, STATS } from '../helpers/ability-game.ts';

/** What the tests' hooks see: the game's aura system, once it is made, and the lines they log. */
const seen: { auras?: AuraSystem<AbilityGame>; lines: string[] } = { lines: [] };

/** The aura system the hooks read, or a clear error before it is made. */
const current = (): { readonly auras: AuraSystem<AbilityGame> } => {
  if (seen.auras === undefined) {
    throw new Error('No test game yet.');
  }

  return { auras: seen.auras };
};

/** A release that logs the spell, the caster's place, the input, the rank and what the caster holds as it releases. */
const logRelease =
  (name: string) =>
  (ctx: SpellContext<AbilityGame>): undefined => {
    const { auras } = current();
    const hero = ctx.caster;
    const input = ctx.input === undefined ? '-' : `${ctx.input.x},${ctx.input.z}`;
    const cooling = auras.remaining(hero, auraNamed('dodgeCooldown'));

    seen.lines.push(
      `${name} at ${hero.at.x},${hero.at.z} input ${input} rank ${ctx.rank} cooling ${cooling} sprint ${auras.remaining(hero, auraNamed('sprint'))} charge ${auras.stacks(hero, auraNamed('charge'))}`,
    );

    return undefined;
  };

/** A button spell that logs its release. */
const button = (name: string, data: Omit<ButtonActivation<AbilityGame>, 'kind'> = {}, spellRanks = 1) =>
  spell({ ranks: spellRanks, activation: { kind: 'button', ...data }, release: logRelease(name) });

/** The dodge: a sprint scaled by Duration, a heading from the input, and travel while sprinting. */
const roll = button('roll', {
  cooldown: 2,
  applies: [{ aura: 'sprint', scaledBy: 'duration' }],

  activate: ({ bearer, input, dt, stats }) => {
    seen.lines.push(`activate roll dt ${dt} duration ${stats?.total(STATS.id.duration)}`);
    bearer.heading = input ?? bearer.heading;
  },

  travel: ({ bearer, dt, world }) => {
    if (current().auras.has(bearer, auraNamed('sprint'))) {
      const to = { x: bearer.at.x + bearer.heading.x * 4 * dt, z: bearer.at.z + bearer.heading.z * 4 * dt };

      bearer.at = world.moveBody([bearer.at, to], 0.5).position;
    }
  },
});

/** A test game over every test ability, in a static world (an open one when absent). */
const makeGame = (world?: StaticWorld) =>
  makeAbilityGame(
    {
      roll,
      hop: button('hop', { cooldown: 1 }),
      nova: button(
        'nova',
        { cooldown: scaled(ranks(8, 6), haste(1)), cost: { aura: auraNamed('charge'), stacks: 2 } },
        2,
      ),
      blast: button('blast', { cooldown: 3, cost: { aura: auraNamed('charge'), stacks: 2 } }),
      timed: button('timed', { cooldown: (hero, rank) => hero.id + rank }),
      surge: button('surge', { cooldown: 30, applies: [{ aura: auraNamed('stance') }], resets: ['cooldown.dodge'] }),
      guard: button('guard', { requires: ['stance'] }),
      anchor: button('anchor', { applies: [{ aura: auraNamed('root') }] }),
      flee: button('flee', { blockedBy: ['rooted'] }),

      sentry: spell({
        activation: { kind: 'button', cooldown: 5, startsOn: 'cast' },
        canCast: (ctx) => (ctx.input?.x ?? -1) >= 0,
        release: logRelease('sentry'),
      }),

      wall: spell({
        activation: { kind: 'button', cooldown: 4 },
        canCast: () => false,
        release: logRelease('wall'),
      }),
    },
    world === undefined ? {} : { world },
  );

/** A test game over every test ability, and a hero. */
const setUp = (world?: StaticWorld): { game: ReturnType<typeof makeGame>; hero: Hero } => {
  const game = makeGame(world);

  seen.auras = game.auras;
  seen.lines = [];

  return { game, hero: game.hero(1) };
};

describe('a press', () => {
  it('fires, starts its slot’s cooldown aura and is refused until it runs out', () => {
    const { game, hero } = setUp();
    const { abilities } = game;
    const { dodge } = abilities.slots.id;

    abilities.equip(hero, dodge, game.id.roll);
    assert.equal(abilities.tryActivate(hero, abilities.bit(dodge)), 1);
    assert.equal(abilities.cooldownLeft(hero, dodge), 2);
    assert.equal(abilities.check(hero, dodge), 'cooldown');
    assert.equal(abilities.tryActivate(hero, abilities.bit(dodge)), 0);
    game.step(7);
    assert.equal(abilities.cooldownLeft(hero, dodge), 0.25);
    game.step();
    assert.equal(abilities.check(hero, dodge), undefined);
    assert.equal(abilities.tryActivate(hero, 0), 0);
    assert.equal(seen.lines.filter((line) => line.startsWith('roll')).length, 1);
  });

  it('reads a scaled cooldown from the caster’s stats at the slot’s rank, or a function of the caster', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { skill, ultimate } = abilities.slots.id;

    hero.stats[STATS.id.abilityHaste] = 100;
    auras.apply(hero, { aura: auraNamed('charge'), stacks: 4 });
    abilities.equip(hero, skill, { spell: game.id.nova, rank: 2 });
    abilities.equip(hero, ultimate, game.id.timed);
    abilities.tryActivate(hero, abilities.bit(skill) | abilities.bit(ultimate));
    assert.equal(abilities.cooldownLeft(hero, skill), 3);
    assert.equal(abilities.cooldownLeft(hero, ultimate), 2);
    assert.match(seen.lines[0] ?? '', /^nova .* rank 2 /);
  });

  it('decides every pressed slot before any fires, then fires them in slot order', () => {
    const { game, hero } = setUp();
    const { abilities } = game;
    const { dodge, skill, ultimate } = abilities.slots.id;
    const all = abilities.bit(dodge) | abilities.bit(skill) | abilities.bit(ultimate);

    abilities.equip(hero, dodge, game.id.roll);
    abilities.equip(hero, skill, game.id.guard);
    abilities.equip(hero, ultimate, game.id.surge);
    assert.equal(abilities.tryActivate(hero, all), abilities.bit(dodge) | abilities.bit(ultimate));
    assert.equal(abilities.cooldownLeft(hero, dodge), 0);
    assert.equal(abilities.cooldownLeft(hero, ultimate), 30);
    assert.equal(abilities.check(hero, skill), undefined);

    const other = game.hero(2);

    abilities.equip(other, skill, game.id.anchor);
    abilities.equip(other, ultimate, game.id.flee);
    assert.equal(abilities.tryActivate(other, all), abilities.bit(skill) | abilities.bit(ultimate));
    assert.equal(abilities.check(other, ultimate), 'blocked');
  });

  it('pays, moves, cools and lands before its cast, which releases before the bearer travels', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { dodge } = abilities.slots.id;

    hero.stats[STATS.id.duration] = 1.5;
    abilities.equip(hero, dodge, game.id.roll);
    abilities.tryActivate(hero, abilities.bit(dodge), { input: { x: 0, z: 1 } });
    abilities.travel(hero, 0.25);
    assert.deepEqual(seen.lines, [
      'activate roll dt 0.25 duration 1.5',
      'roll at 1,0 input 0,1 rank 1 cooling 2 sprint 3 charge 0',
    ]);
    assert.deepEqual(hero.at, { x: 1, z: 1 });
    assert.equal(auras.remaining(hero, auraNamed('sprint')), 3);
  });

  it('hands the motion hooks the game’s static world', () => {
    const wall: StaticWorld = {
      bounds: { minX: -10, minZ: -10, maxX: 10, maxZ: 10 },
      lineClear: () => false,
      isPositionClear: () => false,
      clamp: (p) => p,
      moveBody: ([from]) => ({ position: from, hit: true, share: 0 }),
    };

    const { game, hero } = setUp(wall);
    const { abilities } = game;

    abilities.equip(hero, abilities.slots.id.dodge, game.id.roll);
    abilities.tryActivate(hero, abilities.bit(abilities.slots.id.dodge), { input: { x: 0, z: 1 } });
    abilities.travel(hero, 0.25);
    assert.deepEqual(hero.at, { x: 1, z: 0 });
  });

  it('spends its cost, and drops a later slot whose cost an earlier one of the press spent', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { skill, ultimate } = abilities.slots.id;
    const both = abilities.bit(skill) | abilities.bit(ultimate);

    abilities.equip(hero, skill, game.id.nova);
    abilities.equip(hero, ultimate, game.id.blast);
    assert.equal(abilities.tryActivate(hero, both), 0);
    assert.equal(abilities.check(hero, ultimate), 'cost');
    auras.apply(hero, { aura: auraNamed('charge'), stacks: 3 });
    assert.equal(abilities.check(hero, ultimate), undefined);
    assert.equal(abilities.tryActivate(hero, both), abilities.bit(skill));
    assert.equal(auras.stacks(hero, auraNamed('charge')), 1);
    assert.equal(abilities.cooldownLeft(hero, ultimate), 0);
  });

  it('holds its requires and blockedBy tags', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { skill, ultimate } = abilities.slots.id;

    assert.equal(abilities.check(hero, skill), 'empty');
    abilities.equip(hero, skill, game.id.guard);
    abilities.equip(hero, ultimate, game.id.flee);
    assert.equal(abilities.check(hero, skill), 'requires');
    auras.apply(hero, auraNamed('stance'));
    assert.equal(abilities.check(hero, skill), undefined);
    assert.equal(abilities.check(hero, ultimate), undefined);
    auras.apply(hero, auraNamed('root'));
    assert.equal(abilities.check(hero, ultimate), 'blocked');
  });

  it('starts a cast cooldown only once the cast was not refused, and an activation cooldown either way', () => {
    const { game, hero } = setUp();
    const { abilities } = game;
    const { skill, ultimate } = abilities.slots.id;

    abilities.equip(hero, skill, game.id.sentry);
    abilities.equip(hero, ultimate, game.id.wall);
    assert.equal(abilities.tryActivate(hero, abilities.bit(skill), { input: { x: -1, z: 0 } }), abilities.bit(skill));
    assert.equal(abilities.cooldownLeft(hero, skill), 0);
    abilities.tryActivate(hero, abilities.bit(skill), { input: { x: 1, z: 0 } });
    assert.equal(abilities.cooldownLeft(hero, skill), 5);
    abilities.tryActivate(hero, abilities.bit(ultimate));
    assert.equal(abilities.cooldownLeft(hero, ultimate), 4);
    assert.deepEqual(
      seen.lines.map((line) => line.split(' ')[0]),
      ['sentry'],
    );
  });

  it('keeps the cooldown on the slot, so an ability equipped on a cooling slot inherits it', () => {
    const { game, hero } = setUp();
    const { abilities } = game;
    const { dodge } = abilities.slots.id;

    abilities.equip(hero, dodge, game.id.roll);
    abilities.tryActivate(hero, abilities.bit(dodge));
    abilities.equip(hero, dodge, game.id.hop);
    assert.equal(abilities.check(hero, dodge), 'cooldown');
    assert.equal(abilities.cooldownLeft(hero, dodge), 2);
  });
});
