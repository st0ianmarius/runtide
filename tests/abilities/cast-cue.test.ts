import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PressRefusal } from '../../src/abilities/index.ts';
import { createCueEchoes, type CueEvent } from '../../src/cues/index.ts';
import type { SpellContext, StaticWorld } from '../../src/spells/index.ts';
import { type AbilityGame, auraNamed, CUES, makeAbilityGame, spell, STATS } from '../helpers/ability-game.ts';

/** What the mirror-safe cast cue hooks saw, and what the releases did. */
const lines: string[] = [];

/** A release that logs the spell. */
const logRelease =
  (name: string) =>
  (_ctx: SpellContext<AbilityGame>): undefined => {
    lines.push(`release ${name}`);

    return undefined;
  };

/** The test spells: a button with a predicted cast cue, one whose cast cue is not predicted, and one with none. */
const spells = {
  blink: spell({
    activation: { kind: 'button' },
    cooldown: { aura: 'dodgeCooldown', seconds: 2 },
    timeline: { windup: { seconds: 0.5 } },

    cues: {
      cast: ({ bearer, input, stats, dt, world }) => {
        lines.push(
          `cast cue @${bearer.id} input ${input?.x},${input?.z} haste ${stats?.total(STATS.id.abilityHaste)} dt ${dt} clear ${world.lineClear({ x: 0, z: 0 }, { x: 1, z: 1 })}`
        );

        return { cue: CUES.id.swish, params: { size: 3 } };
      },

      start: () => ({ cue: CUES.id.flash })
    },

    release: logRelease('blink')
  }),

  loud: spell({
    activation: { kind: 'button' },
    cues: { cast: () => ({ cue: CUES.id.flash }) },
    release: logRelease('loud')
  }),

  plain: spell({ activation: { kind: 'button' }, release: logRelease('plain') }),

  sentry: spell({
    activation: {
      kind: 'button',
      commitsOn: 'cast',
      checkCast: ({ input, world }) => input !== undefined && world.isPositionClear(input, 0.5)
    },
    cooldown: { aura: 'skillCooldown', seconds: 2 },
    cues: { cast: () => ({ cue: CUES.id.swish }) },
    release: logRelease('sentry')
  })
};

/** A static world with a wall from x = 5 on: a sentry fits only west of it. */
const WALLED: StaticWorld = {
  bounds: { minX: -10, minZ: -10, maxX: 10, maxZ: 10 },
  lineClear: () => true,
  isPositionClear: (p, radius) => p.x + radius < 5,
  clamp: (p) => p,
  moveBody: ([, to]) => ({ position: to, hit: false, share: 1 })
};

/** The cue ids and keys of a buffer's events, in firing order. */
const firedOf = (events: readonly CueEvent[]): string[] =>
  events.map((event) => `${CUES.name(event.cue)}@${event.owner} key ${event.key}`);

describe('the mirror-safe cast cue', () => {
  it('fires on the server as the cast starts, before the start cue, with the cast’s key', () => {
    lines.length = 0;

    const game = makeAbilityGame(spells);
    const hero = game.hero(4);

    hero.stats[STATS.id.abilityHaste] = 20;
    game.spells.cast(hero, game.id.blink, { input: { x: 1, z: 2 }, key: 7 });
    assert.deepEqual(firedOf(game.cues.events), ['swish@4 key 7', 'flash@4 key 0']);
    assert.deepEqual(lines, ['cast cue @4 input 1,2 haste 20 dt 0.25 clear true']);
  });

  it('fires alone on a prediction mirror (predictCast), starting no cast, and refuses a cue that is not predicted', () => {
    lines.length = 0;

    const game = makeAbilityGame(spells);
    const hero = game.hero(4);

    assert.equal(game.spells.predictCast(hero, game.id.blink, { input: { x: 0, z: 1 }, key: 9 }), true);
    assert.equal(game.spells.isCasting(hero), false);
    assert.equal(game.spells.predictCast(hero, game.id.plain), false);
    assert.deepEqual(firedOf(game.cues.events), ['swish@4 key 9']);
    assert.throws(() => game.spells.predictCast(hero, game.id.loud), /loud's cast cue must be a predicted cue/);
  });

  it('lets the client drop the server’s echo of the cue it predicted', () => {
    const client = makeAbilityGame(spells);
    const server = makeAbilityGame(spells);
    const echoes = createCueEchoes(CUES);

    client.spells.predictCast(client.hero(4), client.id.blink, { key: 12 });
    server.spells.cast(server.hero(4), server.id.blink, { key: 12 });

    for (const event of client.cues.events) {
      echoes.note(event);
    }

    assert.deepEqual(
      server.cues.events.map((event) => echoes.isEcho(event)),
      [true, false]
    );
  });
});

describe('presses on a prediction mirror', () => {
  it('land only the predicted auras a button applies; the server lands them all', () => {
    const rush = spell({
      activation: { kind: 'button', applies: [auraNamed('sprint'), auraNamed('stance')] },
      release: logRelease('rush')
    });

    const landed = (mirror: boolean): boolean[] => {
      const game = makeAbilityGame({ rush }, { mirror });
      const hero = game.hero(4);
      const { abilities } = game;

      abilities.equip(hero, abilities.slots.id.skill, game.id.rush);
      abilities.tryActivate(hero, abilities.bit(abilities.slots.id.skill));

      return [game.auras.has(hero, auraNamed('sprint')), game.auras.has(hero, auraNamed('stance'))];
    };

    assert.deepEqual(landed(true), [true, false]);
    assert.deepEqual(landed(false), [true, true]);
  });

  it('run the motion half, cooldowns and costs, fire only the cast cues with the press’s key, and cast nothing', () => {
    lines.length = 0;

    const game = makeAbilityGame(spells, { mirror: true });
    const hero = game.hero(4);
    const { abilities } = game;
    const { dodge, skill } = abilities.slots.id;

    abilities.equip(hero, dodge, game.id.blink);
    abilities.equip(hero, skill, game.id.plain);
    assert.equal(abilities.tryActivate(hero, abilities.bit(dodge) | abilities.bit(skill), { key: 5 }), 3);
    assert.deepEqual(firedOf(game.cues.events), ['swish@4 key 5']);
    assert.equal(game.spells.isCasting(hero), false);
    assert.deepEqual(lines, ['cast cue @4 input undefined,undefined haste 0 dt 0.25 clear true']);
    assert.equal(abilities.cooldownLeft(hero, dodge), 2);
    assert.equal(game.auras.has(hero, auraNamed('dodgeCooldown')), true);
  });

  it('leave a button that commits on its cast, with no checkCast, to the server: nothing committed or cued', () => {
    const tether = spell({
      activation: { kind: 'button', commitsOn: 'cast', cost: { aura: auraNamed('charge') } },
      cooldown: { aura: 'skillCooldown', seconds: 3 },
      cues: { cast: () => ({ cue: CUES.id.swish }) },
      release: logRelease('tether')
    });

    const game = makeAbilityGame({ tether }, { mirror: true });
    const hero = game.hero(4);
    const { abilities } = game;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    game.auras.apply(hero, { aura: auraNamed('charge'), stacks: 1 });
    abilities.equip(hero, abilities.slots.id.skill, game.id.tether);
    assert.equal(abilities.tryActivate(hero, abilities.bit(abilities.slots.id.skill), { refusals }), 0);
    assert.deepEqual(
      [refusals[abilities.slots.id.skill], game.cues.events.length, game.auras.stacks(hero, auraNamed('charge'))],
      ['server', 0, 1]
    );
  });

  it('hand the motion half the rank the slot holds the spell at', () => {
    const ranked: number[] = [];

    const surge = spell({
      ranks: 3,
      activation: { kind: 'button', activate: ({ rank }) => void ranked.push(rank) },
      release: logRelease('surge')
    });

    const game = makeAbilityGame({ surge }, { mirror: true });
    const hero = game.hero(4);
    const { abilities } = game;

    abilities.equip(hero, abilities.slots.id.skill, { spell: game.id.surge, rank: 3 });
    abilities.tryActivate(hero, abilities.bit(abilities.slots.id.skill));
    assert.deepEqual(ranked, [3]);
  });

  it('carry the press’s key into the server’s casts too', () => {
    const game = makeAbilityGame(spells);
    const hero = game.hero(4);
    const { abilities } = game;

    abilities.equip(hero, abilities.slots.id.dodge, game.id.blink);
    abilities.tryActivate(hero, abilities.bit(abilities.slots.id.dodge), {
      input: { x: 1, z: 0 },
      key: 21
    });
    assert.deepEqual(firedOf(game.cues.events), ['swish@4 key 21', 'flash@4 key 0']);
    assert.equal(abilities.cooldownLeft(hero, abilities.slots.id.dodge), 2);
  });
});

describe('a button’s checkCast (a sentry’s placement)', () => {
  /** Presses the sentry on the skill slot at a point: the cues fired, the slot's cooldown, and whether it casts. */
  const place = (mirror: boolean, at: { x: number; z: number }) => {
    lines.length = 0;

    const game = makeAbilityGame(spells, { world: WALLED, mirror });
    const hero = game.hero(4);
    const { abilities } = game;
    const { skill } = abilities.slots.id;

    abilities.equip(hero, skill, game.id.sentry);
    abilities.tryActivate(hero, abilities.bit(skill), { input: at, key: 3 });

    return [firedOf(game.cues.events), abilities.cooldownLeft(hero, skill), game.spells.isCasting(hero), [...lines]];
  };

  it('lets a clear placement cast and start its cast cooldown, on the server and the mirror alike', () => {
    assert.deepEqual(place(false, { x: 1, z: 0 }), [['swish@4 key 3'], 2, false, ['release sentry']]);
    assert.deepEqual(place(true, { x: 1, z: 0 }), [['swish@4 key 3'], 2, false, []]);
  });

  it('refuses a blocked placement with no cue and no cooldown, on the server and the mirror alike', () => {
    assert.deepEqual(place(false, { x: 9, z: 0 }), [[], 0, false, []]);
    assert.deepEqual(place(true, { x: 9, z: 0 }), [[], 0, false, []]);
  });
});
