import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cancelTimer, setTimer } from '../../src/ai/index.ts';
import { createScriptSystem, defineBehaviour, defineScripts, type ScriptCtx } from '../../src/scripts/index.ts';
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
    }
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
      }
    }
  });

  const scripts = defineScripts<UnitGame, 'caster'>({ caster: [first, second, watcher] });

  const templates = {
    caster: { script: 'caster' },
    grunt: {},
    add: {}
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

describe('scripts', () => {
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
      2
    );
    assert.deepEqual(unscripted, ['raise@2']);
    assert.equal(game.events.includes('timer pick a@1'), false);
    game.scripts.step(caster);
    assert.deepEqual(game.events.slice(-1), ['timer pick a@1']);
    game.scripts.step(caster);
    assert.equal(game.events.filter((line) => line.startsWith('timer')).length, 1);
  });

  it('fire an unscripted unit’s timer handed to the game once, though its brain is held and let go after', () => {
    const game = scripted();
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });
    const unscripted: string[] = [];

    const step = (): void => {
      game.clock.step();
      game.scripts.collect((_unit, timer) => unscripted.push(`${TIMERS.names[timer] ?? '?'}@${game.clock.time}`));
    };

    game.ai.start(grunt, TIMERS.id.raise, 0.5);

    for (let i = 0; i < 4; i++) {
      step();
    }

    assert.deepEqual(unscripted, ['raise@0.5']);
    assert.equal(game.ai.cancel(grunt, TIMERS.id.raise), false, 'it fired: nothing runs to cancel');
    game.ai.hold(grunt, 'freeze', true);
    step();
    game.ai.hold(grunt, 'freeze', false);

    for (let i = 0; i < 4; i++) {
      step();
    }

    assert.deepEqual(unscripted, ['raise@0.5']);
  });

  it('stop a dead unit’s script and hold its timers, then go on where they were after a revive', () => {
    const log: string[] = [];

    const life = behaviour({
      state: () => ({ phase: 1, ticks: 0 }),
      spawn: () => [setTimer<UnitGame>('pick', 1)],

      tick: (ctx) => {
        ctx.state.ticks += 1;

        return undefined;
      },

      timer: (ctx) => {
        log.push(`timer phase ${ctx.state.phase} at ${game.clock.time}`);

        return undefined;
      },

      died: (ctx) => {
        log.push(`died phase ${ctx.state.phase}`);
        ctx.state.phase = 2;

        return undefined;
      },

      revived: (ctx) => {
        log.push(`revived phase ${ctx.state.phase}`);

        return undefined;
      },

      on: {
        changed: (_ctx, event) => {
          log.push(`heard ${event.unit?.id ?? '?'} ${event.to}`);

          return undefined;
        }
      }
    });

    const game = makeUnitGame(
      { boss: { script: 'boss' }, add: {} },
      { scripts: defineScripts<UnitGame, 'boss'>({ boss: [life] }) }
    );

    // The fixture delivers `changed` to the unit's owner: the boss hears its adds die.
    const boss = game.units.spawn(game.id.boss, { side: 1 });
    const [early, late] = [1, 2].map(() => game.units.spawn(game.id.add, { side: 1, owner: boss }));

    const step = (count: number): void => {
      for (let i = 0; i < count; i++) {
        game.clock.step();
        game.scripts.collect();
        game.scripts.step(boss);
      }
    };

    step(2);
    game.units.kill(boss);

    const left = game.ai.remaining(boss, TIMERS.id.pick);

    step(8);

    if (early !== undefined && late !== undefined) {
      game.units.kill(early);
      assert.equal(game.ai.remaining(boss, TIMERS.id.pick), left, 'its timer held while it is dead');
      assert.equal(game.scripts.stateOf(boss, life)?.ticks, 2, 'no step while dead');
      game.units.revive(boss);
      game.units.kill(late);
    }

    step(2);
    assert.deepEqual(log, ['died phase 1', 'revived phase 2', `heard ${late?.id ?? 0} dead`, 'timer phase 2 at 3']);
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
      [`${add?.id ?? 0} dead seen by 1`]
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
    assert.deepEqual(game.scripts.stateOf(second, game.first), {
      label: 'a',
      id: second.id,
      ticks: 0
    });
  });

  it('stop a record’s handlers once its unit despawns in one, even when the next spawn takes the record', () => {
    const log: string[] = [];

    const ender = behaviour({
      tick: (ctx) => {
        log.push(`ender ${ctx.unit.id}`);
        game.units.despawn(ctx.unit);
        game.units.spawn(game.id.plain, { side: 1 });

        return undefined;
      }
    });

    const after = behaviour({
      tick: (ctx) => {
        log.push(`after ${ctx.unit.id}`);

        return undefined;
      }
    });

    const scripts = defineScripts<UnitGame, 'ending' | 'plain'>({ ending: [ender, after], plain: [behaviour({})] });

    const game = makeUnitGame(
      { ending: { script: 'ending' }, plain: { script: 'plain' } } satisfies Record<string, UnitDef<UnitGame>>,
      { scripts }
    );

    const unit = game.units.spawn(game.id.ending, { side: 1 });

    game.clock.step();
    game.scripts.collect();
    game.scripts.step(unit);
    assert.deepEqual(log, [`ender ${unit.id}`]);
  });

  it('skip a collected timer a handler before it cancelled or started again', () => {
    const log: string[] = [];

    const both = behaviour({
      spawn: () => [setTimer<UnitGame>('pick', 0.25), setTimer<UnitGame>('raise', 0.25)],

      timer: (ctx, timer) => {
        log.push(`${TIMERS.names[timer] ?? '?'} ${ctx.unit.id}`);

        return timer === TIMERS.id.pick ? [cancelTimer<UnitGame>('raise')] : undefined;
      }
    });

    const game = makeUnitGame({ both: { script: 'both' } } satisfies Record<string, UnitDef<UnitGame>>, {
      scripts: defineScripts<UnitGame, 'both'>({ both: [both] })
    });

    const unit = game.units.spawn(game.id.both, { side: 1 });

    for (let i = 0; i < 4; i++) {
      game.clock.step();
      game.scripts.collect();
      game.scripts.step(unit);
    }

    assert.deepEqual(log, [`pick ${unit.id}`]);
  });

  it('let a handler run procs mid-way through ctx.run, nested handlers taking their own context', () => {
    const log: string[] = [];

    const owner = behaviour({
      on: {
        changed: (ctx) => {
          log.push(`owner ${ctx.unit.id} sees an add go`);

          return undefined;
        }
      }
    });

    const suicidal = behaviour({
      tick: (ctx) => {
        const count = ctx.run([summon<UnitGame>('add')]);

        log.push(`summoned ${count} by ${ctx.unit.id}`);

        return undefined;
      }
    });

    const templates = {
      boss: { script: 'boss' },
      add: { script: 'add' }
    } satisfies Record<string, UnitDef<UnitGame>>;

    const game = makeUnitGame(templates, {
      scripts: defineScripts<UnitGame, 'boss' | 'add'>({ boss: [suicidal, owner], add: [] })
    });

    const boss = game.units.spawn(game.id.boss, { side: 1 });

    game.scripts.collect();
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
          host: {}
        }),
      /Script dancer handles changed, which the script system does not bind/
    );
    assert.throws(() => game.units.spawn(game.id.caster, { side: 1 }), /no script named nope/);

    const forged = behaviour({});

    Reflect.set(forged, 'tick', 3);
    assert.throws(
      () => defineScripts<UnitGame, 'bad'>({ bad: [forged] }),
      /Script bad, behaviour 0: its tick is not a function/
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

describe('scripts under hooks that despawn or throw', () => {
  for (const moment of ['spawn', 'tick'] as const) {
    it(`stops later ${moment} handlers when an earlier handler kills the unit, while running all died handlers`, () => {
      const log: string[] = [];

      const first = behaviour({
        [moment]: (ctx: ScriptCtx<UnitGame>) => {
          log.push(moment);
          game.units.kill(ctx.unit);

          return undefined;
        },

        died: () => (log.push('died first'), undefined)
      });

      const second = behaviour({
        [moment]: () => (log.push('late'), undefined),
        died: () => (log.push('died second'), undefined)
      });

      const game = makeUnitGame(
        { boss: { script: 'boss' } },
        { scripts: defineScripts<UnitGame, 'boss'>({ boss: [first, second] }) }
      );

      const unit = game.units.spawn(game.id.boss, { side: 1 });

      game.scripts.collect();

      if (moment === 'tick') {
        game.scripts.step(unit);
      }

      game.scripts.step(unit);
      assert.deepEqual(log, [moment, 'died first', 'died second']);
    });
  }

  it('stops later bound event handlers when an earlier handler kills their unit', () => {
    const log: string[] = [];

    const first = behaviour({
      on: {
        changed: (ctx) => {
          log.push('changed');
          game.units.kill(ctx.unit);

          return undefined;
        }
      }
    });

    const second = behaviour({ on: { changed: () => (log.push('late'), undefined) } });

    const game = makeUnitGame(
      { boss: { script: 'boss' }, add: {} },
      { scripts: defineScripts<UnitGame, 'boss'>({ boss: [first, second] }) }
    );

    const boss = game.units.spawn(game.id.boss, { side: 1 });
    const add = game.units.spawn(game.id.add, { side: 1, owner: boss });

    game.units.kill(add);
    assert.deepEqual(log, ['changed']);
  });

  for (const throws of [false, true]) {
    it(`stops timer handlers and ticks after a fatal timer handler${throws ? ' that throws' : ''}, resuming held timers once on revive`, () => {
      const log: string[] = [];

      const first = behaviour({
        spawn: () => [setTimer<UnitGame>('pick', 0.25), setTimer<UnitGame>('raise', 0.25)],

        timer: (ctx, timer) => {
          log.push(`first ${TIMERS.names[timer]}`);

          if (timer === TIMERS.id.pick) {
            game.units.kill(ctx.unit);

            if (throws) {
              throw new Error('fatal timer');
            }
          }

          return undefined;
        },

        tick: () => (log.push('tick'), undefined)
      });

      const second = behaviour({ timer: (_ctx, timer) => (log.push(`second ${TIMERS.names[timer]}`), undefined) });

      const game = makeUnitGame(
        { boss: { script: 'boss' } },
        { scripts: defineScripts<UnitGame, 'boss'>({ boss: [first, second] }) }
      );

      const unit = game.units.spawn(game.id.boss, { side: 1 });

      game.clock.step();
      game.scripts.collect();

      if (throws) {
        assert.throws(() => {
          game.scripts.step(unit);
        }, /fatal timer/);
      } else {
        game.scripts.step(unit);
      }

      game.scripts.step(unit);
      assert.deepEqual(log, ['first pick']);
      game.units.revive(unit);
      game.scripts.step(unit);
      assert.deepEqual(log, ['first pick', 'tick'], 'death dropped the old due list');
      game.clock.step();
      game.scripts.collect();
      game.scripts.step(unit);
      assert.deepEqual(log, ['first pick', 'tick', 'first raise', 'second raise', 'tick']);
    });
  }

  it('runs no tick for a unit its own timer handler despawned', () => {
    const log: string[] = [];
    const late: { game?: ReturnType<typeof makeUnitGame> } = {};

    const doomed = behaviour({
      spawn: () => [setTimer<UnitGame>('pick', 0.25)],

      timer: (ctx) => {
        log.push(`timer ${ctx.unit.id}`);
        late.game?.units.despawn(ctx.unit);

        return undefined;
      },

      tick: (ctx) => {
        log.push(`tick ${ctx.unit.id}`);

        return undefined;
      }
    });

    const game = makeUnitGame(
      { grunt: { script: 'doomed' } },
      { scripts: defineScripts<UnitGame, 'doomed'>({ doomed: [doomed] }) }
    );

    late.game = game;

    const unit = game.units.spawn(game.id.grunt, { side: 1 });

    game.clock.step();
    game.scripts.collect();
    game.scripts.step(unit);
    assert.deepEqual(log, ['timer 1']);
  });

  it('frees the record of a unit whose state factory threw, so the next spawn takes it', () => {
    let isBroken = true;

    const fragile = behaviour({
      state: () => {
        if (isBroken) {
          throw new Error('game bug');
        }

        return {};
      }
    });

    const scripts = defineScripts<UnitGame, 'fragile'>({ fragile: [fragile] });
    const game = makeUnitGame({ grunt: { script: 'fragile' } }, { scripts });

    assert.throws(() => game.units.spawn(game.id.grunt, { side: 1 }), /game bug/);
    isBroken = false;
    assert.equal(game.units.spawn(game.id.grunt, { side: 1 }).scriptSlot, 0);
    assert.deepEqual([game.scripts.count(scripts.id.fragile), game.scripts.records.live], [1, 1]);
  });

  it('keeps the timers due after a throwing handler for the next step', () => {
    const log: string[] = [];
    let isBroken = true;

    const both = behaviour({
      spawn: () => [setTimer<UnitGame>('pick', 0.25), setTimer<UnitGame>('raise', 0.25)],

      timer: (_ctx, timer) => {
        log.push(TIMERS.names[timer] ?? '?');

        if (isBroken) {
          isBroken = false;

          throw new Error('game bug');
        }

        return undefined;
      }
    });

    const game = makeUnitGame(
      { grunt: { script: 'both' } },
      { scripts: defineScripts<UnitGame, 'both'>({ both: [both] }) }
    );

    const unit = game.units.spawn(game.id.grunt, { side: 1 });

    game.clock.step();
    game.scripts.collect();
    assert.throws(() => {
      game.scripts.step(unit);
    }, /game bug/);
    game.scripts.step(unit);
    assert.deepEqual(log, ['pick', 'raise']);
  });
});
