import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setTimer } from '../../src/ai/index.ts';
import { damage } from '../../src/damage/index.ts';
import { type ProcOutcome, run } from '../../src/procs/index.ts';
import { type AnyBehaviour, defineBehaviour, defineScripts } from '../../src/scripts/index.ts';
import { makeUnitGame, TIMERS, type UnitGame } from '../helpers/unit-game.ts';

const behaviour = defineBehaviour<UnitGame>();

describe('scripts guard their procs and their definitions', () => {
  it('drop the procs of a handler that killed its own unit, returned or run through ctx.run', () => {
    const ran: number[] = [];

    const suicidal = behaviour({
      tick: (ctx) => {
        game.units.kill(ctx.unit);
        ran.push(ctx.run([setTimer<UnitGame>('pick', 3)]));

        return [setTimer<UnitGame>('raise', 5)];
      },

      died: () => [setTimer<UnitGame>('pick', 2)]
    });

    const game = makeUnitGame(
      { boss: { script: 'boss' } },
      { scripts: defineScripts<UnitGame, 'boss'>({ boss: [suicidal] }) }
    );

    const boss = game.units.spawn(game.id.boss, { side: 1 });

    game.scripts.step(boss);
    assert.deepEqual(ran, [0], 'ctx.run runs nothing once its unit is dead');
    assert.equal(game.ai.remaining(boss, TIMERS.id.raise), undefined, 'the returned timer is dropped');
    assert.equal(game.ai.remaining(boss, TIMERS.id.pick), 2, 'a died handler’s procs still run');
  });

  it('hand the timers of a scripted unit whose script has no timer handler to the game', () => {
    const idle = behaviour({ tick: () => undefined });

    const game = makeUnitGame(
      { boss: { script: 'boss' } },
      { scripts: defineScripts<UnitGame, 'boss'>({ boss: [idle] }) }
    );

    const boss = game.units.spawn(game.id.boss, { side: 1 });
    const fired: string[] = [];

    game.ai.start(boss, TIMERS.id.raise, 0.25);

    for (let i = 0; i < 3; i++) {
      game.clock.step();
      game.scripts.collect((unit, timer) => fired.push(`${TIMERS.names[timer] ?? '?'}@${unit.id}`));
      game.scripts.step(boss);
    }

    assert.deepEqual(fired, [`raise@${boss.id}`]);
  });

  it('attach a spawn a spawned listener killed dead: died in place of spawn, then revived and on as usual', () => {
    const log: string[] = [];

    const life = behaviour({
      state: () => ({ ticks: 0 }),
      spawn: () => (log.push('spawn'), undefined),
      died: () => (log.push('died'), undefined),
      revived: () => (log.push('revived'), undefined),

      tick: (ctx) => {
        ctx.state.ticks += 1;

        return undefined;
      }
    });

    const scripts = defineScripts<UnitGame, 'boss'>({ boss: [life] });
    const game = makeUnitGame({ boss: { script: 'boss' } }, { scripts });

    game.on('spawned', (event) => {
      if (event.unit !== undefined) {
        game.units.kill(event.unit);
      }
    });

    const boss = game.units.spawn(game.id.boss, { side: 1 });

    game.scripts.step(boss);
    assert.deepEqual([game.scripts.has(boss), game.scripts.count(scripts.id.boss)], [true, 1]);
    assert.equal(game.scripts.stateOf(boss, life)?.ticks, 0, 'no step while dead');
    game.units.revive(boss);
    game.scripts.step(boss);
    assert.deepEqual(log, ['died', 'revived']);
    assert.equal(game.scripts.stateOf(boss, life)?.ticks, 1);
  });

  it('apply one proc through ctx.apply and read its outcome, skipped once the unit is gone', () => {
    const outcomes: ProcOutcome[] = [];

    const striker = behaviour({
      tick: (ctx) => {
        const target = game.units.byId(ctx.unit.id + 1);

        if (target !== undefined) {
          outcomes.push({ ...ctx.apply(damage<UnitGame>(30, { to: target })) });
          game.units.despawn(ctx.unit);
          outcomes.push({ ...ctx.apply(damage<UnitGame>(30, { to: target })) });
        }

        return undefined;
      }
    });

    const game = makeUnitGame(
      { boss: { script: 'boss' }, dummy: {} },
      { scripts: defineScripts<UnitGame, 'boss'>({ boss: [striker] }) }
    );

    const boss = game.units.spawn(game.id.boss, { side: 1 });
    const dummy = game.units.spawn(game.id.dummy, { side: 2 });

    game.scripts.step(boss);
    assert.deepEqual(
      outcomes.map(({ status, amount }) => `${status} ${amount}`),
      ['landed 30', 'skipped 0']
    );
    assert.equal(dummy.health, 70);
  });

  it('aim a bound event handler’s procs at the event’s units its binding names, and no other handler’s', () => {
    const seen: string[] = [];
    const note = run<UnitGame>('note', (ctx) => seen.push(`${ctx.eventUnit?.id ?? '-'} ${ctx.other?.id ?? '-'}`));
    const watcher = behaviour({ tick: () => [note], on: { kill: () => [note] } });
    const avenger = behaviour({ on: { changed: () => [damage<UnitGame>(25, { to: 'eventUnit' })] } });

    const game = makeUnitGame(
      { necromancer: { script: 'necromancer' }, warden: { script: 'warden' }, add: {} },
      { scripts: defineScripts<UnitGame, 'necromancer' | 'warden'>({ necromancer: [watcher], warden: [avenger] }) }
    );

    const necromancer = game.units.spawn(game.id.necromancer, { side: 1 });
    const victim = game.units.spawn(game.id.add, { side: 2 });

    game.procs.apply(damage<UnitGame>(500), { self: necromancer, target: victim });
    game.scripts.step(necromancer);
    assert.deepEqual(seen, [`- ${victim.id}`, '- -'], 'the kill’s other unit, cleared after');

    const warden = game.units.spawn(game.id.warden, { side: 1 });
    const add = game.units.spawn(game.id.add, { side: 1, owner: warden });

    game.units.kill(add);
    game.units.revive(add, 50);
    assert.equal(add.health, 25, 'struck as the change’s event unit');
  });

  it('refuse a behaviour listed twice, an unknown key, a script that is no list and a behaviour that is no object', () => {
    const once = behaviour({ tick: () => undefined });
    const loose = { tick: () => undefined, tock: () => undefined };

    assert.throws(
      () => defineScripts<UnitGame, 'twice'>({ twice: [once, behaviour({}), once] }),
      /Script twice lists one behaviour twice, as behaviours 0 and 2/
    );
    assert.throws(
      () => defineScripts<UnitGame, 'odd'>({ odd: [loose] }),
      /Script odd, behaviour 0 has an unknown key tock/
    );
    assert.throws(() => behaviour(loose), /A behaviour has an unknown key tock/);

    const flat: Record<string, readonly AnyBehaviour<UnitGame>[]> = {};
    const holey = [once, once];

    Reflect.set(flat, 'flat', once);
    Reflect.set(holey, 1, null);
    assert.throws(() => defineScripts<UnitGame, string>(flat), /Script flat is not a list of behaviours/);
    assert.throws(() => defineScripts<UnitGame, 'holey'>({ holey }), /Script holey, behaviour 1 is not an object/);
  });
});
