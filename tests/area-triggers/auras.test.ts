import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AnyAreaTriggerDef, type AreaAura, defineAreaTriggers } from '../../src/area-triggers/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { AREA_TAGS, aura, type Game, makeSpellGame } from '../helpers/spell-game.ts';

/** A field that keeps one aura on the units in it. */
const field = (spec: AreaAura<Game>, lifetime = 10): AnyAreaTriggerDef<Game> => ({
  shape: circle(2),
  lifetime,
  auras: [spec]
});

/** A game with a field kind and the auras it keeps. */
const fieldGame = (spec: AreaAura<Game>, lifetime?: number) =>
  makeSpellGame(
    {},
    {
      auras: { chilled: aura({ duration: 'infinite' }), soothed: aura({ duration: 5 }) },
      areaTriggers: { field: field(spec, lifetime) }
    }
  );

/** Steps a game's clock, its area triggers and a unit's auras `count` times. */
const ticks = (
  game: ReturnType<typeof fieldGame>,
  count: number,
  bearers: readonly Parameters<typeof game.place>[0][]
) => {
  for (let i = 0; i < count; i++) {
    game.step();
    game.areaTriggers.step();

    for (const bearer of bearers) {
      game.auras.tick(bearer, 'world');
    }
  }
};

describe('area auras on enter and exit', () => {
  it('puts its aura on a foe that enters, takes it off as it leaves, and off every unit inside as it ends', () => {
    const game = fieldGame({ aura: 'chilled' });
    const [foe, ally, other] = [game.unit(100), game.unit(2), game.unit(101)];

    const handle = game.areaTriggers.spawn(game.areaId.field, {
      owner: game.unit(1),
      at: vec2(0, 0)
    });

    game.place(foe, vec2(1, 0));
    game.place(ally, vec2(0, 1));
    game.place(other, vec2(0, -1));
    ticks(game, 1, []);
    assert.equal(game.auras.has(foe, game.auraId.chilled), true);
    assert.equal(game.auras.has(ally, game.auraId.chilled), false);
    assert.equal(game.auras.find(foe, game.auraId.chilled)?.source, 1);
    game.place(foe, vec2(10, 0));
    ticks(game, 1, []);
    assert.equal(game.auras.has(foe, game.auraId.chilled), false);
    assert.equal(game.auras.has(other, game.auraId.chilled), true);
    game.areaTriggers.despawn(handle);
    assert.equal(game.auras.has(other, game.auraId.chilled), false);
  });

  it('keeps the aura while a unit is still inside another field, and takes it off as it leaves the last', () => {
    const game = fieldGame({ aura: 'chilled' });
    const foe = game.unit(100);
    const owner = game.unit(1);

    game.place(foe, vec2(0, 0));

    const first = game.areaTriggers.spawn(game.areaId.field, { owner, at: vec2(-1, 0) });
    const second = game.areaTriggers.spawn(game.areaId.field, { owner, at: vec2(1, 0) });

    ticks(game, 1, []);
    game.areaTriggers.despawn(first);
    assert.equal(game.auras.has(foe, game.auraId.chilled), true);
    game.areaTriggers.despawn(second);
    assert.equal(game.auras.has(foe, game.auraId.chilled), false);
  });

  it('lets through only the units its filter keeps, and the side it names', () => {
    const game = fieldGame({
      aura: 'chilled',
      side: 'allies',
      unitFilter: (_c, unit) => unit.id !== 3
    });

    const [ally, filtered, foe] = [game.unit(2), game.unit(3), game.unit(100)];

    game.place(ally, vec2(1, 0));
    game.place(filtered, vec2(-1, 0));
    game.place(foe, vec2(0, 1));
    game.areaTriggers.spawn(game.areaId.field, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1, []);
    assert.deepEqual(
      [ally, filtered, foe].map((unit) => game.auras.has(unit, game.auraId.chilled)),
      [true, false, false]
    );
  });
});

describe('area auras that linger', () => {
  it('are left with their linger as a unit leaves, and back to their own length as it comes back', () => {
    const game = fieldGame({ aura: 'chilled', linger: 0.75, stacks: 1 });
    const foe = game.unit(100);

    game.place(foe, vec2(0, 0));
    game.areaTriggers.spawn(game.areaId.field, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 4, [foe]);
    assert.equal(game.auras.find(foe, game.auraId.chilled)?.stacks, 1);
    assert.equal(game.auras.remaining(foe, game.auraId.chilled), Infinity);
    game.place(foe, vec2(10, 0));
    ticks(game, 1, [foe]);
    assert.equal(game.auras.remaining(foe, game.auraId.chilled), 0.5, 'its linger, less the step it left on');
    ticks(game, 1, [foe]);
    assert.equal(game.auras.has(foe, game.auraId.chilled), true);
    game.place(foe, vec2(0, 0));
    ticks(game, 1, [foe]);
    assert.equal(game.auras.remaining(foe, game.auraId.chilled), Infinity);
    game.place(foe, vec2(10, 0));
    ticks(game, 4, [foe]);
    assert.equal(game.auras.has(foe, game.auraId.chilled), false);
  });

  it('leave a unit alone whose aura something else took off while it was inside', () => {
    const game = fieldGame({ aura: 'chilled', linger: 0.75 });
    const foe = game.unit(100);

    game.place(foe, vec2(0, 0));
    game.areaTriggers.spawn(game.areaId.field, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1, [foe]);
    game.auras.remove(foe, game.auraId.chilled);
    game.place(foe, vec2(10, 0));
    ticks(game, 1, [foe]);
    assert.equal(game.auras.has(foe, game.auraId.chilled), false);
  });
});

describe('area aura checks at load', () => {
  it('refuse a linger that is not seconds above 0, stacks below 1, and an unknown aura', () => {
    const refuse = (spec: AreaAura<Game>, message: RegExp): void => {
      assert.throws(() => defineAreaTriggers<Game, 'bad'>({ bad: field(spec) }, { tags: AREA_TAGS }), message);
    };

    refuse({ aura: 'chilled', linger: 0 }, /lingers for seconds above 0/);
    refuse({ aura: 'chilled', stacks: 0 }, /a whole number of stacks/);
    assert.throws(() => makeSpellGame({}, { areaTriggers: { bad: field({ aura: 'nothing' }) } }), /area aura nothing/);
  });
});
