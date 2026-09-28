import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { damage, heal, setHealth } from '../../src/damage/index.ts';
import { add, compileScaled, scaled, snapshotScaled } from '../../src/modifiers/index.ts';
import { applyAura, escapeReport, explainProc, type Proc, run } from '../../src/procs/index.ts';
import { aura, type Game, makeDamageGame, STATS } from '../helpers/damage-game.ts';
import { invalid } from '../helpers/trigger-game.ts';

/** A fire blow, which the test armor does not touch. */
const fire = (amount: number, options: Omit<Parameters<typeof damage<Game>>[1], 'damageKind'> = {}): Proc<Game> =>
  damage<Game>(amount, { ...options, damageKind: 'fire' });

describe('the damage proc', () => {
  it('deals a blow from the unit the list is credited to: its outgoing multipliers apply', () => {
    const game = makeDamageGame({}, { outgoing: ['power'] });
    const [target, attacker] = [game.unit(1), game.unit(2)];

    game.set(attacker, 'power', 2);
    game.procs.run([fire(10)], { self: attacker, target });
    assert.equal(target.hp, 80);
  });

  it('credits a periodic beat to the aura’s caster, found by the host’s unitOf', () => {
    const game = makeDamageGame(
      { burn: aura({ duration: 'infinite', periodic: { every: 0.125, onBeat: () => [fire(5)] } }) },
      { outgoing: ['power'] },
    );

    const [victim, caster] = [game.unit(1), game.unit(2)];

    game.set(caster, 'power', 2);
    game.set(victim, 'power', 10);
    game.auras.apply(victim, { aura: game.id.burn, source: caster.id });
    game.auras.tick(victim, 'world');
    assert.equal(victim.hp, 90);
  });

  it('deals a blow as the world’s with attacker none', () => {
    const game = makeDamageGame({}, { outgoing: ['power'] });
    const [target, attacker] = [game.unit(1), game.unit(2)];

    game.set(attacker, 'power', 2);
    game.procs.run([fire(10, { attacker: 'none' })], { self: attacker, target });
    assert.equal(target.hp, 90);
  });

  it('finishes a scaled value’s target terms against each target at the hit (§II.3.13)', () => {
    const game = makeDamageGame({});
    const [target, caster] = [game.unit(1), game.unit(2)];
    const value = compileScaled(STATS, scaled(10, add('maxHealth', 0.1, { from: 'target' })));
    const snapshot = snapshotScaled(value, { caster: { total: () => 0, base: () => 0 } });

    game.set(target, 'maxHealth', 200);
    game.procs.run([damage<Game>(snapshot, { damageKind: 'fire' })], { self: caster, target });
    assert.equal(target.hp, 70);
  });

  it('skips a unit the list already killed', () => {
    const game = makeDamageGame({});
    const [target, attacker] = [game.unit(1), game.unit(2)];

    assert.equal(game.procs.run([fire(150), fire(5)], { self: attacker, target }), 1);
    assert.equal(target.hp, -50);
  });

  it('resolves its damage kind’s name at load, and refuses an unknown one', () => {
    const game = makeDamageGame({});
    const [prepared] = game.procs.prepare([fire(5)], 'test list');

    assert.deepEqual(prepared, { kind: 'damage', amount: 5, damageKind: game.damage.kinds.id.fire });
    assert.throws(
      () => game.procs.prepare([invalid(fire(5), { damageKind: 'ice' })], 'bad'),
      /Unknown damage kind ice/,
    );
  });

  it('explains itself as data', () => {
    const game = makeDamageGame({});

    assert.deepEqual(explainProc(game.procs, fire(12, { knock: 2 })).values, {
      amount: 12,
      damageKind: game.damage.kinds.id.fire,
      knock: 2,
    });
  });
});

describe('outcome-gated procs (§II.6 P4)', () => {
  const gated = { chilled: aura({ duration: 3 }), rage: aura({ duration: 3 }) };

  it('follow a blow that landed, aimed at the blow’s target', () => {
    const game = makeDamageGame(gated);
    const [target, attacker] = [game.unit(1), game.unit(2)];

    game.procs.run([fire(10, { to: target, andThen: [applyAura('chilled')] })], { self: attacker, target: attacker });
    assert.equal(game.auras.has(target, game.id.chilled), true);
    assert.equal(game.auras.has(attacker, game.id.chilled), false);
  });

  it('wait for the statuses they name', () => {
    const game = makeDamageGame(gated, { block: { chance: 'blockChance' } });
    const [target, attacker] = [game.unit(1), game.unit(2)];

    game.set(target, 'blockChance', 1);
    game.procs.run(
      [
        fire(10, { andThen: [applyAura('chilled')] }),
        fire(10, { on: ['blocked'], andThen: [applyAura('rage', { to: 'self' })] }),
      ],
      { self: attacker, target },
    );

    assert.equal(game.auras.has(target, game.id.chilled), false);
    assert.equal(game.auras.has(attacker, game.id.rage), true);
  });

  it('see the kill noted first: those aimed at the killed target do nothing, the rest run', () => {
    const game = makeDamageGame(gated);
    const [target, attacker] = [game.unit(1), game.unit(2)];

    game.procs.run([fire(150, { andThen: [applyAura('chilled'), applyAura('rage', { to: 'self' })] })], {
      self: attacker,
      target,
    });
    assert.equal(game.auras.has(target, game.id.chilled), false);
    assert.equal(game.auras.has(attacker, game.id.rage), true);
  });

  it('leave the blow’s own outcome as the one reported', () => {
    const game = makeDamageGame(gated);
    const [target, attacker] = [game.unit(1), game.unit(2)];
    const outcome = game.procs.apply(fire(10, { andThen: [fire(500, { to: 'self' })] }), { self: attacker, target });

    assert.deepEqual([outcome.status, outcome.amount, outcome.hasKilled], ['landed', 10, false]);
    assert.equal(attacker.hp, -400);
  });
});

describe('the damage system’s proc kinds (§I.5.2, §I.5.6)', () => {
  it('are frozen, work detached, and count as the framework’s in the escape report, beside the game’s stages', () => {
    const game = makeDamageGame({}, { stages: { horde: { before: 'ignore', run: () => undefined } } });
    const { apply } = game.damage.procKinds.damage;
    const target = game.unit(1);

    assert.equal(Object.isFrozen(game.damage.procKinds), true);
    game.procs.run(
      [
        run<Game>('detached', (ctx) => {
          apply(damage<Game>(5, { damageKind: 'fire' }), ctx, target);
        }),
      ],
      { self: target },
    );
    assert.equal(target.hp, 95);
    assert.deepEqual(escapeReport({ procs: game.procs, damage: game.damage }), {
      procKinds: [],
      runs: [{ hatch: 'detached', count: 1 }],
      stages: ['damage.horde'],
    });
    assert.deepEqual(escapeReport({ procs: game.procs }).procKinds, ['damage', 'heal', 'setHealth']);
  });
});

describe('the heal and setHealth procs', () => {
  it('heal a share of one of the target’s stats', () => {
    const game = makeDamageGame({});
    const target = game.unit(1);

    target.hp = 50;
    game.procs.run([heal<Game>(0.2, { of: 'maxHealth' })], { self: target });
    assert.equal(target.hp, 70);
  });

  it('set health to a share of the maximum, and a kill through setHealth is noted for the list', () => {
    const game = makeDamageGame({});
    const [target, other] = [game.unit(1), game.unit(2)];

    game.procs.run([setHealth<Game>({ share: 0.3 })], { self: target });
    assert.equal(target.hp, 30);
    assert.equal(game.procs.run([setHealth<Game>(0), fire(5)], { self: other, target }), 1);
  });
});
