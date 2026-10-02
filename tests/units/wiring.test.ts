import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAiSystem } from '../../src/ai/index.ts';
import { createBitset, createEntityIds } from '../../src/core/index.ts';
import { CORE_PROCS, createProcRegistry, createProcSystem } from '../../src/procs/index.ts';
import type { SpellId } from '../../src/spells/index.ts';
import type { UnitDef } from '../../src/units/index.ts';
import { auraId, makeUnitGame, SPELL_TAGS, STATS, TIMERS, type UnitGame } from '../helpers/unit-game.ts';

/** The test templates: a hero and a grunt. */
const TEMPLATES = { hero: {}, grunt: {} } satisfies Record<string, UnitDef<UnitGame>>;

/** Whether a value is the game's damage spell: a spell name stands for one, as a game naming spells has them. */
const isNamedSpell = (value: unknown): value is SpellId => typeof value === 'string';

/** A spell name as the test game's damage spell. */
const named = (name: string): SpellId => {
  if (!isNamedSpell(name)) {
    throw new TypeError('not a name');
  }

  return name;
};

describe('spell-scoped stats', () => {
  it('reads a unit’s stats within spell scopes, and a damage spell by its name', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const statsOf = game.units.damageHost.statsOf;

    assert.ok(statsOf !== undefined);
    game.auras.apply(hero, auraId('scopedMight'));
    assert.equal(game.units.statsOf(hero, undefined, createBitset([SPELL_TAGS.id.attack])).total(STATS.id.might), 2);
    assert.equal(game.units.statsOf(hero).total(STATS.id.might), 1);
    assert.equal(statsOf(hero, named('swing')).total(STATS.id.might), 2);
    assert.equal(statsOf(hero, named('channel')).total(STATS.id.might), 1);
    assert.throws(() => statsOf(hero, named('fireball')), /damage spell named fireball is not in the spell registry/);
  });

  it('gives the spell host a unit’s gate and its stats within a spell’s tags', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const { spell, aura } = game.units.hosts;

    game.auras.apply(hero, auraId('scopedMight'));
    assert.equal(spell.statsOf(hero, game.spellId.swing)?.total(STATS.id.might), 2);
    assert.equal(spell.canAct(hero, game.spellId.swing), true);
    game.auras.apply(hero, auraId('stun'));
    aura.onTagsChanged(hero);
    assert.equal(spell.canAct(hero, game.spellId.swing), false);
    game.units.kill(hero);
    assert.equal(spell.canAct(hero, game.spellId.swing), false);
  });
});

describe('a spawn’s own entity id', () => {
  it('is refused where the shared counter owns ids, unless the counter can reserve it', () => {
    const ids = createEntityIds();
    const strict = makeUnitGame(TEMPLATES, { allocateId: ids.next });

    assert.throws(() => strict.units.spawn(strict.id.grunt, { side: 1, id: 7 }), /allocateId owns the ids/);
    assert.equal(strict.units.live(), 0);

    const reserved: number[] = [];
    const game = makeUnitGame(TEMPLATES, { allocateId: ids.next, reserveId: (id) => reserved.push(id) });

    assert.equal(game.units.spawn(game.id.grunt, { side: 1, id: 7 }).id, 7);
    assert.deepEqual(reserved, [7]);

    const own = makeUnitGame(TEMPLATES);

    assert.equal(own.units.spawn(own.id.grunt, { side: 1, id: 7 }).id, 7);
    assert.equal(own.units.spawn(own.id.grunt, { side: 1 }).id, 8);
  });
});

describe('the wiring check', () => {
  it('passes the test game’s wiring, and names each gate left unwired', () => {
    const game = makeUnitGame(TEMPLATES);
    const { spells, auras, ai, procs, units } = game;

    units.checkWiring({ spells, auras, ai, procs });

    const otherAi = createAiSystem<UnitGame>({ spells, clock: game.clock, timers: TIMERS });

    assert.throws(() => {
      units.checkWiring({ spells, auras, ai: otherAi });
    }, /wiring, ai:/);

    const copied = createProcRegistry<UnitGame>({
      ...CORE_PROCS,
      ...game.damage.procKinds,
      ...spells.procKinds,
      ...units.procKinds,
      ...ai.procKinds,
      revive: { ...units.procKinds.revive }
    });

    const bare = createProcSystem<UnitGame>({ kinds: copied, auras, host: procs.host });

    assert.throws(() => {
      units.checkWiring({ spells, auras, procs: bare });
    }, /procs.kinds: .*units.procKinds.revive/);

    const nameless = createProcSystem<UnitGame>({ kinds: procs.kinds, auras, host: {} });

    assert.throws(() => {
      units.checkWiring({ spells, auras, procs: nameless });
    }, /procs.host: idOf and unitOf/);
    assert.throws(() => {
      units.checkWiring({ spells, auras, areaTriggers: {} });
    }, /wiring, areaTriggers:/);

    const areas = makeUnitGame(TEMPLATES, { areaTriggers: { ownerGone: () => 0 } });

    assert.throws(() => {
      areas.units.checkWiring({ spells: areas.spells, auras: areas.auras, areaTriggers: {} });
    }, /wiring, allocateId:/);
  });
});
