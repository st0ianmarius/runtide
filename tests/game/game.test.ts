import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AURAS, makeTestWorld, tick } from './fixture.ts';

describe('a game built by createGame', () => {
  it('binds every late edge: hosts are the units’, the aura and damage hosts run through the procs', () => {
    const { game } = makeTestWorld();

    assert.equal(game.spells.host.canAct, game.units.hosts.spell.canAct);
    assert.equal(game.spells.host.statsOf, game.units.hosts.spell.statsOf);
    assert.equal(game.spells.host.isGone, game.units.hosts.spell.isGone);
    assert.equal(game.auras.host.onTagsChanged, game.units.hosts.aura.onTagsChanged);
    assert.equal(game.auras.host.run, game.procs.runAura);
    assert.equal(game.damage.host.run, game.procs.runAura);
    assert.equal(game.damage.host.remove, game.units.damageHost.remove);
    assert.equal(game.procs.host.unitOf, game.units.byId);
  });

  it('names units by entity id to the spell host, so a cast cue’s owner and a cast’s credit are its caster’s id', () => {
    const { game, hero } = makeTestWorld();

    assert.equal(game.spells.host.idOf?.(hero), hero.id);
  });

  it('keeps its memory world in step with the units', () => {
    const { game, hero, grunts } = makeTestWorld();
    const world = game.memoryWorld;
    const grunt = grunts[0];

    assert.ok(world !== undefined && grunt !== undefined);
    assert.equal(world.size, 4);
    assert.equal(world.sideOf(hero), 0);
    game.units.setSide(grunt, 0);
    assert.equal(world.sideOf(grunt), 0);
    game.units.despawn(grunt);
    assert.equal(world.has(grunt), false);
  });

  it('stepped 20 ticks in the documented order passes its audit every tick, with casts, areas and deaths', () => {
    const { game, hero, pool } = makeTestWorld();

    pool();

    for (let i = 0; i < 20; i++) {
      tick(game);
      game.audit();
    }

    assert.ok(hero.health < hero.maxHealth, 'the grunts hit the hero');
    assert.ok(game.units.live() < 4, 'the pool killed grunts, despawned at the end of their tick');
  });
});

describe('the game digest', () => {
  it('is equal for two games driven alike at every tick, and parts after one extra blow', () => {
    const a = makeTestWorld();
    const b = makeTestWorld();

    a.pool();
    b.pool();

    for (let i = 0; i < 10; i++) {
      assert.equal(a.game.digest(), b.game.digest(), `tick ${i}`);
      tick(a.game);
      tick(b.game);
    }

    assert.equal(a.game.digest(), b.game.digest());
    b.game.damage.hit({ target: b.hero, amount: 1 });
    assert.notEqual(a.game.digest(), b.game.digest());
  });

  it('parts on an aura alone, which the units digest does not hold', () => {
    const a = makeTestWorld();
    const b = makeTestWorld();

    b.game.auras.apply(b.hero, AURAS.id.haste);
    assert.notEqual(a.game.digest(), b.game.digest());
  });
});

describe('the game audit', () => {
  it('names a unit whose spells were stepped twice', () => {
    const { game, grunts } = makeTestWorld();
    const grunt = grunts[1];

    assert.ok(grunt !== undefined);
    tick(game, { twice: grunt });
    assert.throws(game.audit, new RegExp(`unit ${grunt.id}'s spells.step ran 2 times, not once`));
  });

  it('names an area trigger slot left unstepped', () => {
    const { game } = makeTestWorld();

    tick(game, { skipAreas: true });
    assert.throws(game.audit, /areas.step did not run for slot 0/);
  });

  it('names a tick whose timers were neither stepped nor collected, and a script step before the collect throws', () => {
    const { game, hero } = makeTestWorld();

    tick(game, { skipCollect: true });
    assert.throws(game.audit, /neither ai.step nor scripts.collect ran/);

    game.clock.step();
    assert.throws(() => game.scripts?.step(hero), /collect/);
  });

  it('names a unit whose auras were not ticked, listing every problem at once', () => {
    const { game, hero } = makeTestWorld();

    game.clock.step();
    assert.throws(game.audit, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(`unit ${hero.id}'s auras ticked 0 times on clock world, not once`));
      assert.match(error.message, /spells.stepAuto ran 0 times/);
      assert.match(error.message, /spells.stepDelayed did not run for slot 0/);

      return true;
    });
  });
});
