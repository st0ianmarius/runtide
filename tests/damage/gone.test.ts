import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { damage, setHealth } from '../../src/damage/index.ts';
import { aura, type DamageGame, KINDS, makeDamageGame } from '../helpers/damage-game.ts';

describe('units out of play', () => {
  it('take no blow, heal or death once the host says they are gone, whatever their health', () => {
    const gone = new Set<number>();
    const { damage: system, unit, log } = makeDamageGame({}, {}, { isGone: (target) => gone.has(target.id) });
    const target = unit(1);

    gone.add(1);
    assert.equal(system.hit({ target, amount: 500 }).status, 'skipped');
    assert.equal(system.heal({ target, amount: 5 }).status, 'skipped');
    assert.equal(system.setHealth(target, 0).status, 'skipped');
    assert.equal(target.hp, 100);
    assert.deepEqual(log, []);
  });

  it('refuses a health that is not a finite number', () => {
    const { damage: system, unit } = makeDamageGame({});

    assert.throws(() => system.setHealth(unit(1), Number.NaN), /finite number/);
  });

  it('ends a blow skipped when a nested blow killed its target, and never deals it', () => {
    const {
      damage: system,
      auras,
      id,
      unit,
      log
    } = makeDamageGame({
      fragile: aura({
        duration: 5,
        onIncomingDamage: (ctx) => (ctx.bearer.hp > 0 ? { procs: [damage(1000)] } : undefined)
      })
    });

    const [target, attacker] = [unit(1), unit(2)];

    auras.apply(target, id.fragile);

    const blow = system.hit({ target, attacker, amount: 10 });

    assert.equal(blow.status, 'skipped');
    assert.equal(target.hp, -900);
    assert.equal(log.filter((line) => line.startsWith('remove')).length, 1);
  });

  it('ends a heal skipped when a hook’s blow killed its target, and never raises the corpse', () => {
    const late: { game?: DamageGame<'necrotic'> } = {};

    const game = makeDamageGame({
      necrotic: aura({
        duration: 5,
        value: 10,
        onIncomingHeal: (ctx, heal) => ({ absorb: Math.min(ctx.aura.value, heal.amount) }),

        onRemoved: (ctx) => {
          late.game?.damage.hit({ target: ctx.bearer, amount: 10 });

          return undefined;
        }
      })
    });

    late.game = game;

    const target = game.unit(1);

    target.hp = 10;
    game.auras.apply(target, game.id.necrotic);

    const heal = game.damage.heal({ target, healer: game.unit(2), amount: 40 });

    assert.deepEqual([heal.status, heal.amount, target.hp], ['skipped', 0, 0]);
  });

  it('credits a setHealth proc that kills to the list’s attacker', () => {
    const { procs, bus, unit, log } = makeDamageGame({});
    const [target, killer] = [unit(1), unit(2)];

    bus.on(bus.kind.kill, (event) => log.push(`kill ${event.death?.unit.id} by ${event.death?.killer?.id}`));
    procs.run([setHealth(0)], { self: killer, target });
    assert.ok(log.includes('kill 1 by 2'));
  });

  it('spends an outgoing heal absorb from the healer’s own aura', () => {
    const {
      damage: system,
      auras,
      id,
      unit
    } = makeDamageGame({
      withered: aura({
        duration: 5,
        value: 20,
        onOutgoingHeal: (ctx, heal) => ({ absorb: Math.min(ctx.aura.value, heal.amount) })
      })
    });

    const [target, healer] = [unit(1), unit(2)];

    target.hp = 10;
    auras.apply(healer, id.withered);
    assert.equal(system.heal({ target, healer, amount: 15 }).amount, 0);
    assert.equal(auras.find(healer, id.withered)?.value, 5);
    assert.equal(system.heal({ target, healer, amount: 15 }).amount, 10);
    assert.equal(auras.has(healer, id.withered), false);
  });

  it('lets a chain of kills through procs run past the proc depth cap, each death rebasing it', () => {
    const late: { game?: DamageGame<never> } = {};

    const game = makeDamageGame(
      {},
      {
        death: {
          after: [
            (death) => {
              const next = late.game?.units.get(death.unit.id + 1);

              if (next !== undefined) {
                late.game?.procs.run([damage(1000)], { self: death.unit, target: next });
              }
            }
          ]
        }
      },
      {
        procs: {
          rebase: () => late.game?.procs.rebase() ?? 0,
          restoreBase: (base) => late.game?.procs.restoreBase(base)
        }
      }
    );

    late.game = game;

    for (let id = 1; id <= 12; id++) {
      game.unit(id);
    }

    game.damage.hit({ target: game.units.get(1) ?? game.unit(1), amount: 1000 });
    assert.equal([...game.units.values()].filter((each) => each.hp <= 0).length, 12);
    assert.equal(game.procs.dropped, 0);
  });
});

describe('pipelines that cannot turn a sign or move the dead', () => {
  it('takes a whole blow, and no more, when a damage-taken multiplier goes below 0', () => {
    const { damage: system, unit, set } = makeDamageGame({});
    const [attacker, target] = [unit(1), unit(2)];

    set(target, 'taken', -0.5);

    const blow = system.hit({ target, attacker, amount: 40, kind: KINDS.id.fire });

    assert.deepEqual([blow.amount, target.hp], [0, 100]);
  });

  it('moves no unit a force stage’s blow killed', () => {
    const game = makeDamageGame(
      {},
      {
        forceStages: {
          spike: {
            before: 'apply',

            run: (force, system) => {
              system.hit({ target: force.target, amount: 500, kind: KINDS.id.pure });

              return undefined;
            }
          }
        }
      }
    );

    const force = game.damage.force({ target: game.unit(2), strength: 3 });

    assert.deepEqual([force.status, force.amount], ['skipped', 0]);
    assert.equal(
      game.log.some((line) => line.startsWith('force')),
      false
    );
  });
});
