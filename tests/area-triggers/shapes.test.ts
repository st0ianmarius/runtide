import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AreaInterception, type AreaTriggerContext, NO_AREA_TRIGGER } from '../../src/area-triggers/index.ts';
import { circle, covers, lane, vec2 } from '../../src/math/index.ts';
import { run } from '../../src/procs/index.ts';
import { aura, type Game, makeSpellGame } from '../helpers/spell-game.ts';

/** Checks both direct shape reads and the queries that use the placed shape. */
const checkPlacement = (c: AreaTriggerContext<Game>): void => {
  assert.equal(c.shape.kind, 'circle');

  if (c.shape.kind === 'circle') {
    assert.deepEqual(c.shape.at, c.position);
  }

  assert.equal(c.areas.coveredBy(c.position, { kind: c.kind }), c.handle);
  assert.equal(c.areas.coveredBy(vec2(0, 0), { kind: c.kind }), NO_AREA_TRIGGER);

  const out: AreaInterception = { handle: NO_AREA_TRIGGER, share: 1 };

  c.areas.intercept(vec2(c.position.x - 2, 0), vec2(c.position.x + 2, 0), { kind: c.kind }, out);
  assert.deepEqual(out, { handle: c.handle, share: 0.25 });
};

describe('area shape placement after motion', () => {
  for (const phase of ['move', 'frame'] as const) {
    for (const contact of [false, true]) {
      it(`places each advance in ${phase}, ${contact ? 'before contact callbacks' : 'without contact'}`, () => {
        const contacts: number[] = [];
        const advanced: number[] = [];

        const motion = (c: AreaTriggerContext<Game>): undefined => {
          for (const [x, at] of [
            [4, 0.5],
            [8, 1]
          ] as const) {
            c.advance(vec2(x, 0), at);
            checkPlacement(c);
            advanced.push(c.position.x);
          }

          return undefined;
        };

        const game = makeSpellGame(
          {},
          {
            areaTriggers: {
              blade: {
                shape: circle(1),
                lifetime: 10,
                [phase]: motion,
                ...(contact ? { contact: { radius: 0.1 } } : {}),

                onContact: (c) => {
                  checkPlacement(c);
                  contacts.push(c.position.x);

                  return undefined;
                }
              }
            }
          }
        );

        game.place(game.unit(100), vec2(3, 0));
        game.place(game.unit(101), vec2(7, 0));
        game.world.tick();
        const handle = game.areaTriggers.spawn(game.areaId.blade, { owner: game.unit(1), at: vec2(0, 0) });

        game.step();
        game.areaTriggers.step();
        assert.deepEqual(advanced, [4, 8]);
        assert.deepEqual(contacts, contact ? [4, 8] : []);
        assert.equal(game.areaTriggers.coveredBy(vec2(8, 0), {}), handle);
      });
    }
  }

  for (const order of [undefined, ['frame', 'pulses', 'auras'] as const]) {
    it(`refreshes frame movement, heading and dynamic shape before procs, pulses and auras (${order === undefined ? 'default' : 'custom'} order)`, () => {
      const pulses: number[][] = [];
      let ran = false;

      const game = makeSpellGame(
        {},
        {
          auras: { chilled: aura({ duration: 'infinite' }) },
          areaTriggers: {
            field: {
              shape: (c) => lane({ length: c.heading === 0 ? 1 : 4, width: 1, dir: 0 }),
              lifetime: 10,
              ...(order === undefined ? {} : { order }),
              auras: [{ aura: 'chilled' }],
              every: [
                {
                  seconds: 0.25,

                  onPulse: (_c, hit) => {
                    pulses.push(hit.targets.map((unit) => unit.id));

                    return undefined;
                  }
                }
              ],

              frame: (c) => {
                c.position.x = 5;
                c.heading = Math.PI / 2;

                return [
                  run<Game>('field.checkShape', () => {
                    assert.equal(covers(c.shape, vec2(8, 0)), true);
                    assert.equal(covers(c.shape, vec2(0, 0.5)), false);
                    assert.equal(c.areas.coveredBy(vec2(8, 0), {}), c.handle);
                    ran = true;
                  })
                ];
              }
            }
          }
        }
      );

      const old = game.unit(100);
      const moved = game.unit(101);

      game.place(old, vec2(0, 0.5));
      game.place(moved, vec2(8, 0));
      game.areaTriggers.spawn(game.areaId.field, { owner: game.unit(1), at: vec2(0, 0) });
      game.step();
      game.areaTriggers.step();
      assert.equal(ran, true);
      assert.deepEqual(pulses, [[101]]);
      assert.equal(game.auras.has(old, game.auraId.chilled), false);
      assert.equal(game.auras.has(moved, game.auraId.chilled), true);
    });
  }
});
