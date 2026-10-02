import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AnyAreaTriggerDef, spawn } from '../../src/area-triggers/index.ts';
import { circle } from '../../src/math/index.ts';
import { type Game, makeSpellGame, TICK_SLOTS } from '../helpers/spell-game.ts';

/** A kind that logs its name each frame. */
const logged = (name: string, def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
  shape: circle(1),
  lifetime: 5,

  frame: (c) => {
    c.host.log.push(name);

    return undefined;
  },

  ...def
});

/**
 * A blade that spawns a crescent on its first frame, the crescent's kind registered before the blade's; the frame
 * order of 3 ticks, each led by its number, without the event log's lines.
 */
const bladeOrder = (crescent: Partial<AnyAreaTriggerDef<Game>>): readonly string[] => {
  let isSpawned = false;

  const game = makeSpellGame(
    {},
    {
      areaTriggers: {
        crescent: logged('crescent', crescent),

        blade: logged('blade', {
          frame: (c) => {
            c.host.log.push('blade');

            if (isSpawned) {
              return undefined;
            }

            isSpawned = true;

            return [spawn<Game>('crescent')];
          }
        })
      }
    }
  );

  assert.equal(game.procs.apply(spawn<Game>('blade'), { self: game.unit(1) }).status, 'landed');
  assert.deepEqual([game.areaTriggers.registry.id['crescent'], game.areaTriggers.registry.id['blade']], [0, 1]);

  for (let tick = 1; tick <= 3; tick++) {
    game.step();
    game.log.push(`tick ${tick}`);
    game.areaTriggers.step();
  }

  return game.log.slice(game.log.indexOf('tick 1')).filter((line) => !line.includes('@'));
};

describe('the step order of kinds within a tick slot', () => {
  it('is registry order: a child of a kind registered before its parent’s steps before its parent', () => {
    assert.deepEqual(bladeOrder({}), ['tick 1', 'blade', 'tick 2', 'crescent', 'blade', 'tick 3', 'crescent', 'blade']);
  });

  it('steps a kind after the kinds its after names, its id still in registry order', () => {
    assert.deepEqual(bladeOrder({ after: ['blade'] }), [
      'tick 1',
      'blade',
      'tick 2',
      'blade',
      'crescent',
      'tick 3',
      'blade',
      'crescent'
    ]);
  });

  it('keeps registry order where no after demands otherwise', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          crescent: logged('crescent', { after: ['blade'] }),
          wisp: logged('wisp'),
          blade: logged('blade'),
          spark: logged('spark')
        }
      }
    );

    for (const kind of ['spark', 'blade', 'wisp', 'crescent']) {
      game.procs.apply(spawn<Game>(kind), { self: game.unit(1) });
    }

    game.step();
    game.log.length = 0;
    game.areaTriggers.step();
    assert.deepEqual(
      game.log.filter((line) => !line.includes('@')),
      ['wisp', 'blade', 'crescent', 'spark']
    );
  });

  it('refuses at load a cycle, a kind after itself, a kind of another tick slot and an unknown kind', () => {
    const refuse = (areaTriggers: Readonly<Record<string, AnyAreaTriggerDef<Game>>>, message: RegExp) => {
      assert.throws(() => makeSpellGame({}, { areaTriggers }), { name: 'RangeError', message });
    };

    refuse(
      { crescent: logged('crescent', { after: ['blade'] }), blade: logged('blade', { after: ['crescent'] }) },
      /Area trigger crescent: it steps after blade, whose after leads back to it/
    );
    refuse({ crescent: logged('crescent', { after: ['crescent'] }) }, /Area trigger crescent: it steps after itself/);
    refuse(
      { crescent: logged('crescent', { tickIn: TICK_SLOTS.id.late, after: ['blade'] }), blade: logged('blade') },
      /Area trigger crescent: it steps after blade, of tick slot 0, not its 1/
    );
    refuse(
      { crescent: logged('crescent', { after: ['glaive'] }) },
      /Area trigger crescent: it steps after glaive, which is not a live area trigger/
    );
  });
});
