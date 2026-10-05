import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeUnitGame, ward } from '../helpers/unit-game.ts';

describe('a unit with no body in the world', () => {
  it('owns an area trigger on its own side, as a world script’s director spawns a hazard', () => {
    const game = makeUnitGame({ hero: {}, pet: {} }, { areaTriggers: { ward: ward(() => undefined) } });
    const director = game.units.spawn(game.id.hero, { side: 2 });
    const handle = game.areas.spawn(game.areaId.ward, { owner: director, at: { x: 0, z: 0 } });

    assert.equal(game.areas.get(handle)?.side, 2);
  });
});
