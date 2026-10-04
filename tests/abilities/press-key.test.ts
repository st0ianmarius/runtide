import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CueEvent } from '../../src/cues/index.ts';
import { CUES, makeAbilityGame, spell } from '../helpers/ability-game.ts';

/** A button whose cast cue is predicted, so each press keys it. */
const spells = {
  blink: spell({
    activation: { kind: 'button' },
    cues: { cast: () => ({ cue: CUES.id.swish }) },
    release: () => undefined
  })
};

/** The keys that are not press keys: absent-as-0, negative, fractional, not finite, past 2^53 − 1. */
const BAD_KEYS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53];

/** The cue ids and keys of a buffer's events, in firing order. */
const firedOf = (events: readonly CueEvent[]): string[] =>
  events.map((event) => `${CUES.name(event.cue)} key ${event.key}`);

describe('press keys', () => {
  it('count from 1: a press keyed 0, negative, fractional or past 2^53 − 1 throws before anything fires', () => {
    const game = makeAbilityGame(spells);
    const hero = game.hero(4);
    const { abilities } = game;
    const skill = abilities.bit(abilities.slots.id.skill);

    abilities.equip(hero, abilities.slots.id.skill, game.id.blink);

    for (const key of BAD_KEYS) {
      assert.throws(() => abilities.tryActivate(hero, skill, { key }), RangeError, `key ${key}`);
    }

    assert.equal(game.cues.count, 0);
    assert.equal(game.spells.isCasting(hero), false);
    assert.equal(abilities.cooldownLeft(hero, abilities.slots.id.skill), 0);
  });

  it('fire with the key given, the largest included, and with none (0 on the cue) when absent', () => {
    const game = makeAbilityGame(spells);
    const hero = game.hero(4);
    const { abilities } = game;
    const skill = abilities.bit(abilities.slots.id.skill);

    abilities.equip(hero, abilities.slots.id.skill, game.id.blink);
    abilities.tryActivate(hero, skill, { key: 1 });
    abilities.tryActivate(hero, skill, { key: Number.MAX_SAFE_INTEGER });
    abilities.tryActivate(hero, skill);
    assert.deepEqual(firedOf(game.cues.events), ['swish key 1', `swish key ${Number.MAX_SAFE_INTEGER}`, 'swish key 0']);
  });

  it('are checked on a prediction mirror’s press, on predictCast and on a cast given one', () => {
    const mirror = makeAbilityGame(spells, { mirror: true });
    const hero = mirror.hero(4);
    const { abilities } = mirror;

    abilities.equip(hero, abilities.slots.id.skill, mirror.id.blink);

    for (const key of BAD_KEYS) {
      assert.throws(() => abilities.tryActivate(hero, abilities.bit(abilities.slots.id.skill), { key }), RangeError);
      assert.throws(() => mirror.spells.predictCast(hero, mirror.id.blink, { key }), RangeError);
      assert.throws(() => mirror.spells.cast(hero, mirror.id.blink, { key }), RangeError);
    }

    assert.equal(mirror.cues.count, 0);
    assert.equal(mirror.spells.isCasting(hero), false);
    assert.equal(mirror.spells.pool.live, 0);
    assert.equal(mirror.spells.predictCast(hero, mirror.id.blink, { key: 3 }), true);
    assert.deepEqual(firedOf(mirror.cues.events), ['swish key 3']);
  });

  it('leave a press it interrupted as it was when a nested press’s key throws', () => {
    const game = makeAbilityGame({
      ...spells,
      order: spell({
        activation: {
          kind: 'button',

          activate: () => {
            assert.throws(() =>
              game.abilities.tryActivate(pet, game.abilities.bit(game.abilities.slots.id.skill), { key: 0 })
            );
          }
        },
        cues: { cast: () => ({ cue: CUES.id.swish }) },
        release: () => undefined
      })
    });

    const hero = game.hero(4);
    const pet = game.hero(5);
    const { abilities } = game;

    abilities.equip(hero, abilities.slots.id.dodge, game.id.order);
    abilities.equip(pet, abilities.slots.id.skill, game.id.blink);
    abilities.tryActivate(hero, abilities.bit(abilities.slots.id.dodge), { key: 8 });
    assert.deepEqual(firedOf(game.cues.events), ['swish key 8']);
  });
});
