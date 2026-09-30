import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setTimer } from '../../src/ai/index.ts';
import { defineBehaviour, defineScripts } from '../../src/scripts/index.ts';
import { despawn, summon, type UnitDef } from '../../src/units/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

const behaviour = defineBehaviour<UnitGame>();

/** One bodiless template for every world script, and a rogue. */
const TEMPLATES = {
  world: {},
  rogue: {}
} satisfies Record<string, UnitDef<UnitGame>>;

/**
 * A Blood Horde: a warning, then three unbound rogues; it ends once none is left.
 */
const horde = behaviour({
  state: () => ({ isActive: false }),
  spawn: () => [setTimer<UnitGame>('raise', 0.5)],

  timer: (ctx) => {
    ctx.state.isActive = true;

    return [summon<UnitGame>('rogue', { count: 3, isBound: false })];
  },

  on: {
    changed: (ctx) =>
      ctx.state.isActive && isEmpty(ctx.unit) ? [despawn<UnitGame>({ to: 'self', reason: 'ended' })] : undefined
  }
});

/** The game's reading of a world unit's summons, set once the game is made. */
const summons: { of?: (unit: UnitGame['bearer']) => readonly UnitGame['bearer'][] } = {};

/** Whether an event's spawns are all gone. */
const isEmpty = (unit: UnitGame['bearer']): boolean => (summons.of?.(unit).length ?? 0) === 0;

/** A formation: it steers each of its members on every step, through the game's own fields on them. */
const march = behaviour({
  tick: (ctx) => {
    for (const member of summons.of?.(ctx.unit) ?? []) {
      member.ext.marks += 1;
    }

    return undefined;
  }
});

/** The world scripts: a Blood Horde twice over (sharing one behaviour), and a formation. */
const SCRIPTS = defineScripts<UnitGame, 'bloodHorde' | 'hordeAgain' | 'march'>({
  bloodHorde: [horde],
  hordeAgain: [horde],
  march: [march]
});

/** A game with the world scripts, stepped a tick at a time. */
const world = () => {
  const game = makeUnitGame(TEMPLATES, { scripts: SCRIPTS });

  summons.of = game.units.summonsOf;

  const tick = (units: readonly UnitGame['bearer'][]) => {
    game.clock.step();
    game.scripts.collect();

    for (const unit of units) {
      game.scripts.step(unit);
    }
  };

  const start = (script: 'bloodHorde' | 'hordeAgain' | 'march') => game.units.spawn(game.id.world, { side: 1, script });

  return { ...game, tick, start };
};

describe('world scripts: scripts on bodiless units', () => {
  it('start from one bodiless template, the spawn naming the script', () => {
    const game = world();
    const event = game.start('bloodHorde');

    assert.equal(game.scripts.has(event), true);
    assert.equal(game.scripts.has(game.units.spawn(game.id.world, { side: 1 })), false);
    assert.throws(() => game.units.spawn(game.id.world, { side: 1, script: 'nope' }), /no script named nope/);
  });

  it('run until their spawns are gone, which outlive them when unbound', () => {
    const game = world();
    const event = game.start('bloodHorde');

    game.tick([event]);
    game.tick([event]);

    const rogues = [...game.units.summonsOf(event)];

    assert.equal(rogues.length, 3);
    assert.deepEqual(
      rogues.map((rogue) => rogue.side),
      [1, 1, 1]
    );

    for (const rogue of rogues.slice(0, 2)) {
      game.units.kill(rogue);
    }

    assert.equal(event.lifecycle, 'alive');
    game.units.kill(rogues[2] ?? event);
    assert.equal(event.lifecycle, 'despawned');
    assert.ok(game.log.includes('reason ended'));

    const early = game.start('bloodHorde');

    game.tick([early]);
    game.tick([early]);

    const orphans = [...game.units.summonsOf(early)];

    game.units.despawn(early);
    assert.deepEqual(
      orphans.map((rogue) => [rogue.lifecycle, rogue.owner]),
      [
        ['alive', undefined],
        ['alive', undefined],
        ['alive', undefined]
      ]
    );
  });

  it('count the units running a script, kept as they come and go', () => {
    const game = world();
    const [a, b, c] = [game.start('bloodHorde'), game.start('bloodHorde'), game.start('march')];
    const { id } = SCRIPTS;

    assert.deepEqual([game.scripts.count(id.bloodHorde), game.scripts.count(id.march)], [2, 1]);
    game.units.despawn(a);
    assert.equal(game.scripts.count(id.bloodHorde), 1);
    game.units.despawn(b);
    game.units.despawn(c);
    assert.deepEqual(
      [game.scripts.count(id.bloodHorde), game.scripts.count(id.march), game.scripts.count(id.hordeAgain)],
      [0, 0, 0]
    );
  });

  it('steer the members a formation owns, bound members leaving with it', () => {
    const game = world();
    const group = game.start('march');

    game.procs.apply(summon<UnitGame>('rogue', { count: 2 }), { self: group });
    game.tick([group]);
    assert.deepEqual(
      game.units.summonsOf(group).map((member) => member.ext.marks),
      [1, 1]
    );
    const members = [...game.units.summonsOf(group)];

    game.units.despawn(group);
    assert.deepEqual(
      members.map((member) => member.lifecycle),
      ['despawned', 'despawned']
    );
  });
});
