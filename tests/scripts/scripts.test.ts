import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setTimer } from '../../src/ai/index.ts';
import { createScriptSystem, defineBehaviour, defineScripts } from '../../src/scripts/index.ts';
import { summon, type UnitDef } from '../../src/units/index.ts';
import { makeUnitGame, TIMERS, type UnitGame } from '../helpers/unit-game.ts';

const behaviour = defineBehaviour<UnitGame>();

/** A behaviour that logs its moments into its own state, and starts the pick timer at spawn. */
const logging = (label: string, log: string[]) =>
  behaviour({
    state: (unit) => ({ label, id: unit.id, ticks: 0 }),

    spawn: (ctx) => {
      log.push(`spawn ${ctx.state.label}@${ctx.state.id}`);

      return [setTimer<UnitGame>('pick', 0.5)];
    },

    tick: (ctx) => {
      ctx.state.ticks += 1;

      return undefined;
    },

    timer: (ctx, timer) => {
      log.push(`timer ${TIMERS.names[timer] ?? '?'} ${ctx.state.label}@${ctx.unit.id}`);

      return undefined;
    },
  });

/** A game with a `caster` template running a two-behaviour script, a `grunt` with none, and an `add`. */
const scripted = () => {
  const log: string[] = [];
  const first = logging('a', log);
  const second = behaviour({ spawn: () => (log.push('spawn b'), undefined) });

  const watcher = behaviour({
    on: {
      changed: (ctx, event) => {
        log.push(`${event.unit?.id ?? '?'} ${event.to} seen by ${ctx.unit.id}`);

        return undefined;
      },
    },
  });

  const scripts = defineScripts<UnitGame, 'caster'>({ caster: [first, second, watcher] });

  const templates = {
    caster: { script: 'caster' },
    grunt: {},
    add: {},
  } satisfies Record<string, UnitDef<UnitGame>>;

  const game = makeUnitGame(templates, { scripts });

  return { ...game, events: log, first, second };
};

/** Steps the clock once: collect the due timers, then step each unit in order. */
const tick = (game: ReturnType<typeof scripted>, units: readonly UnitGame['bearer'][]) => {
  game.clock.step();
  game.scripts.collect();

  for (const unit of units) {
    game.scripts.step(unit);
  }
};

describe('scripts (§I.7.1 F19)', () => {
  it('attach at spawn: each behaviour’s state, then its spawn handlers in order, their procs run for the unit', () => {
    const game = scripted();
    const caster = game.units.spawn(game.id.caster, { side: 1 });
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    assert.deepEqual(game.events, ['spawn a@1', 'spawn b']);
    assert.equal(game.scripts.has(caster), true);
    assert.equal(game.scripts.has(grunt), false);
    assert.equal(grunt.scriptSlot, -1);
    assert.equal(game.ai.remaining(caster, TIMERS.id.pick), 0.5);
    assert.deepEqual(game.scripts.stateOf(caster, game.first), { label: 'a', id: 1, ticks: 0 });
    assert.equal(game.scripts.stateOf(caster, logging('c', [])), undefined);
    assert.equal(game.scripts.stateOf(grunt, game.first), undefined);
  });

  it('deliver timers in the unit’s own step, not when collected, and hand unscripted units’ timers to the game', () => {
    const game = scripted();
    const caster = game.units.spawn(game.id.caster, { side: 1 });
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });
    const unscripted: string[] = [];

    game.ai.start(grunt, TIMERS.id.raise, 0.5);
    game.clock.step();
    game.scripts.collect();
    game.clock.step();
    assert.equal(
      game.scripts.collect((unit, timer) => unscripted.push(`${TIMERS.names[timer] ?? '?'}@${unit.id}`)),
      2,
    );
    assert.deepEqual(unscripted, ['raise@2']);
    assert.equal(game.events.includes('timer pick a@1'), false);
    game.scripts.step(caster);
    assert.deepEqual(game.events.slice(-1), ['timer pick a@1']);
    game.scripts.step(caster);
    assert.equal(game.events.filter((line) => line.startsWith('timer')).length, 1);
  });

  it('run tick handlers only for scripted units, and do nothing for the rest', () => {
    const game = scripted();
    const caster = game.units.spawn(game.id.caster, { side: 1 });
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    tick(game, [caster, grunt]);
    tick(game, [caster, grunt]);
    assert.equal(game.scripts.stateOf(caster, game.first)?.ticks, 2);
  });

  it('route bound events to the unit the binding names (a dead add’s owner)', () => {
    const game = scripted();
    const caster = game.units.spawn(game.id.caster, { side: 1 });

    game.procs.apply(summon<UnitGame>('add', { count: 2 }), { self: caster });

    const [add] = game.units.summonsOf(caster);

    if (add !== undefined) {
      game.units.kill(add);
    }

    game.units.kill(game.units.spawn(game.id.grunt, { side: 1 }));
    assert.deepEqual(
      game.events.filter((line) => line.includes('seen')),
      [`${add?.id ?? 0} dead seen by 1`],
    );
  });

  it('free a record at despawn, reuse it for the next unit, and stop routing to the gone unit', () => {
    const game = scripted();
    const first = game.units.spawn(game.id.caster, { side: 1 });

    game.units.despawn(first);
    assert.equal(first.scriptSlot, -1);
    assert.equal(game.scripts.records.live, 0);

    const second = game.units.spawn(game.id.caster, { side: 1 });

    assert.deepEqual([game.scripts.records.live, game.scripts.records.created, second.scriptSlot], [1, 1, 0]);
    assert.deepEqual(game.scripts.stateOf(second, game.first), { label: 'a', id: second.id, ticks: 0 });
  });

  it('let a handler run procs mid-way through ctx.run, nested handlers taking their own context', () => {
    const log: string[] = [];

    const owner = behaviour({
      on: {
        changed: (ctx) => {
          log.push(`owner ${ctx.unit.id} sees an add go`);

          return undefined;
        },
      },
    });

    const suicidal = behaviour({
      tick: (ctx) => {
        const count = ctx.run([summon<UnitGame>('add')]);

        log.push(`summoned ${count} by ${ctx.unit.id}`);

        return undefined;
      },
    });

    const templates = {
      boss: { script: 'boss' },
      add: { script: 'add' },
    } satisfies Record<string, UnitDef<UnitGame>>;

    const game = makeUnitGame(templates, {
      scripts: defineScripts<UnitGame, 'boss' | 'add'>({ boss: [suicidal, owner], add: [] }),
    });

    const boss = game.units.spawn(game.id.boss, { side: 1 });

    game.scripts.step(boss);

    const [add] = game.units.summonsOf(boss);

    assert.ok(add !== undefined);
    assert.equal(game.scripts.has(add), true);
    game.units.kill(add);
    assert.deepEqual(log, ['summoned 1 by 1', 'owner 1 sees an add go']);
  });

  it('refuse an event no binding names, a template naming no script, and a handler that is not a function', () => {
    const dance = behaviour({ on: { changed: () => undefined } });
    const game = makeUnitGame({ caster: { script: 'nope' } });

    assert.throws(
      () =>
        createScriptSystem<UnitGame>({
          registry: defineScripts<UnitGame, 'dancer'>({ dancer: [dance] }),
          ai: game.ai,
          procs: game.procs,
          bus: { on: () => () => undefined },
          host: {},
        }),
      /Script dancer handles changed, which the script system does not bind/,
    );
    assert.throws(() => game.units.spawn(game.id.caster, { side: 1 }), /no script named nope/);

    const forged = behaviour({});

    Reflect.set(forged, 'tick', 3);
    assert.throws(
      () => defineScripts<UnitGame, 'bad'>({ bad: [forged] }),
      /Script bad, behaviour 0: its tick is not a function/,
    );
  });

  it('deep-freeze their behaviours at load, unless told not to', () => {
    const march = behaviour({ on: { changed: () => undefined } });
    const loose = behaviour({ on: { changed: () => undefined } });

    defineScripts<UnitGame, 'march'>({ march: [march] });
    defineScripts<UnitGame, 'loose'>({ loose: [loose] }, { freeze: false });
    assert.deepEqual([Object.isFrozen(march), Object.isFrozen(march.on), Object.isFrozen(loose)], [true, true, false]);
  });
});
