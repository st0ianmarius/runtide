import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rollKey } from '../../src/core/index.ts';
import { damage } from '../../src/damage/index.ts';
import { add, scaled } from '../../src/modifiers/index.ts';
import { run } from '../../src/procs/index.ts';
import {
  type CastHandle,
  CORE_ACTIVATIONS,
  defineActivationKind,
  defineActivations,
  NO_CAST
} from '../../src/spells/index.ts';
import { aura, type Charged, CUES, type Game, makeSpellGame, mark, spell, STATS } from '../helpers/spell-game.ts';

/** A spell that goes out at once and marks its moments. */
const bolt = spell({
  activation: { kind: 'trigger' },
  begin: () => [mark('begin')],
  release: () => [mark('release')],
  onEnd: (_ctx, outcome) => [mark(`onEnd ${outcome}`)]
});

describe('the cast order', () => {
  it('asks the gates, takes the stats, asks canCast, picks the target, then begins and releases', () => {
    const order: string[] = [];

    const game = makeSpellGame(
      {
        slam: spell({
          activation: { kind: 'trigger' },

          stats: () => {
            order.push('stats');

            return { power: 1 };
          },

          canCast: () => {
            order.push('canCast');

            return true;
          },

          target: (_ctx, input) => {
            order.push('target');

            return input;
          },

          begin: () => {
            order.push('begin');

            return undefined;
          },

          release: () => {
            order.push('release');

            return undefined;
          }
        })
      },
      {
        host: {
          canAct: () => {
            order.push('canAct');

            return true;
          }
        }
      }
    );

    const [a, b] = [game.unit(1), game.unit(2)];
    const report = game.spells.cast(a, game.id.slam, { input: b });

    assert.deepEqual(order, ['canAct', 'stats', 'canCast', 'target', 'begin', 'release']);
    assert.equal(report.status, 'ended');
    assert.equal(report.refusal, undefined);
  });

  it('refuses at the gate before the stats, at canCast after them, and with no target after both', () => {
    let stats = 0;
    let canAct = false;
    let canCast = false;

    const game = makeSpellGame(
      {
        slam: spell({
          activation: { kind: 'trigger' },

          stats: () => {
            stats += 1;

            return {};
          },

          canCast: () => canCast,
          target: (_ctx, input) => input,
          release: () => [mark('release')]
        })
      },
      { host: { canAct: () => canAct } }
    );

    const a = game.unit(1);
    const refusal = () => game.spells.cast(a, game.id.slam).refusal;

    assert.equal(refusal(), 'gate');
    assert.equal(stats, 0);
    canAct = true;
    assert.equal(refusal(), 'canCast');
    assert.equal(stats, 1);
    canCast = true;
    assert.equal(refusal(), 'target');
    assert.equal(stats, 2);
    assert.deepEqual(game.log, []);
    assert.equal(game.spells.pool.live, 0);
  });

  it("refuses for a gate's own reason when it answers one in place of false", () => {
    let silenced = true;

    const game = makeSpellGame(
      {
        slam: spell({
          activation: { kind: 'trigger' },
          canCast: () => 'noRage',
          release: () => [mark('release')]
        })
      },
      { host: { canAct: () => (silenced ? 'silenced' : true) } }
    );

    const a = game.unit(1);

    assert.equal(game.spells.cast(a, game.id.slam).refusal, 'silenced');
    silenced = false;
    assert.equal(game.spells.check(a, game.id.slam), 'noRage');
    assert.deepEqual(game.log, []);
  });

  it("asks the activation kind's gate after the host's", () => {
    const charged = defineActivationKind<Charged, Game>({
      gate: (activation, ctx) => ctx.rank >= activation.least
    });

    const activations = defineActivations<Game>({ ...CORE_ACTIVATIONS, charged });

    const game = makeSpellGame(
      { zap: spell({ activation: { kind: 'charged', least: 2 }, release: () => [mark('zap')] }) },
      { activations }
    );

    const a = game.unit(1);

    assert.equal(game.spells.cast(a, game.id.zap, { rank: 1 }).refusal, 'gate');
    assert.equal(game.spells.cast(a, game.id.zap, { rank: 2 }).status, 'ended');
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('zap')),
      ['zap@1']
    );
  });

  it('runs the start cue, begin and the start event, then the release, then the end, in that order', () => {
    const game = makeSpellGame({
      bolt: spell({
        activation: { kind: 'trigger' },
        cues: { start: () => ({ cue: CUES.id.cast, params: { size: 2 } }) },
        begin: () => [mark('begin')],
        release: () => [mark('release')],
        onEnd: (_ctx, outcome) => [mark(`onEnd ${outcome}`)]
      })
    });

    const a = game.unit(1);

    game.spells.cast(a, game.id.bolt);
    assert.deepEqual(game.log, [
      'begin@1',
      'start bolt@1',
      'release@1',
      'release bolt@1',
      'onEnd released@1',
      'end bolt@1 released'
    ]);
    assert.equal(game.cues.count, 1);
    assert.equal(game.cues.events[0]?.owner, 1);
  });

  it('raises no end event for a cast cancelled in begin, whose start event never went out', () => {
    const game = makeSpellGame({
      fizzle: spell({
        activation: { kind: 'trigger' },

        begin: (ctx) => {
          game.spells.cancel(ctx.cast);

          return undefined;
        },

        release: () => [mark('release')],
        onEnd: (_ctx, outcome) => [mark(`onEnd ${outcome}`)]
      })
    });

    game.spells.cast(game.unit(1), game.id.fizzle);
    assert.deepEqual(game.log, ['onEnd cancelled@1']);
  });
});

describe('pooled casts', () => {
  it('reuses one record for casts that do not overlap', () => {
    const game = makeSpellGame({ bolt });
    const a = game.unit(1);

    for (let i = 0; i < 50; i++) {
      game.spells.cast(a, game.id.bolt);
    }

    assert.equal(game.spells.pool.created, 1);
    assert.equal(game.spells.pool.live, 0);
  });

  it('makes a record per cast that overlaps, and hands back a handle that goes stale', () => {
    let inner: CastHandle = NO_CAST;

    const game = makeSpellGame({
      outer: spell({
        activation: { kind: 'trigger' },

        release: (ctx) => [
          run('nest', () => {
            inner = game0.spells.cast(ctx.caster, game0.id.inner).handle;
          })
        ]
      }),
      inner: spell({ activation: { kind: 'trigger' }, release: () => undefined })
    });

    const game0 = game;
    const a = game.unit(1);
    const outer = game.spells.cast(a, game.id.outer).handle;

    assert.equal(game.spells.pool.created, 2);
    assert.notEqual(inner, outer);
    assert.equal(game.spells.get(outer), undefined);
    assert.equal(game.spells.isRunning(outer), false);
  });

  it('stops a cast whose hook throws where it is, and gives its record back', () => {
    const game = makeSpellGame({
      bolt: spell({
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: () => -0.1 } },
        release: () => [mark('bolt released')]
      }),
      boom: spell({
        activation: { kind: 'trigger' },

        begin: () => {
          throw new Error('game bug');
        },

        release: () => [mark('boom released')]
      })
    });

    const hero = game.unit(1);

    assert.throws(() => game.spells.cast(hero, game.id.bolt), /finite number of seconds/);
    assert.throws(() => game.spells.cast(hero, game.id.boom), /game bug/);
    game.spells.step(hero);
    assert.deepEqual([game.spells.isCasting(hero), game.spells.pool.live, game.log], [false, 0, []]);
  });

  it('leaves a channel that breakIf cancelled cancelled, with no recovery', () => {
    const game = makeSpellGame({
      beam: spell({
        activation: { kind: 'trigger' },

        timeline: {
          channel: {
            seconds: 2,

            breakIf: (ctx) => {
              game.spells.cancel(ctx.cast);

              return true;
            }
          },
          recover: { seconds: 1 }
        },

        release: () => undefined
      })
    });

    const hero = game.unit(1);
    const { handle } = game.spells.cast(hero, game.id.beam);

    game.spells.step(hero);
    assert.deepEqual([game.spells.isRunning(handle), game.spells.pool.live], [false, 0]);
    assert.equal(game.log.at(-1), 'end beam@1 cancelled');
  });

  it('refuses a rank that is not a whole number from 1', () => {
    const game = makeSpellGame({ bolt });
    const hero = game.unit(1);

    for (const rank of [0, 1.5, Number.NaN]) {
      assert.throws(() => game.spells.cast(hero, game.id.bolt, { rank }), /a rank is a whole number from 1/);
    }

    assert.equal(game.spells.pool.live, 0);
  });
});

describe('stats (decision 2)', () => {
  /** A spell whose stats read the caster's power, whose begin doubles that power before the release reads it. */
  const powered = (live: boolean) =>
    spell({
      activation: { kind: 'trigger' },
      live,
      stats: { hit: scaled(0, add('power', 1)), radius: 3 },

      begin: (ctx) => [
        run('double', () => {
          ctx.caster.stats[STATS.id.power] = (ctx.caster.stats[STATS.id.power] ?? 0) * 2;
        })
      ],

      release: (ctx) => [mark(`hit ${ctx.stats.hit} radius ${ctx.stats.radius}`)]
    });

  it('takes the stats once, at the start: a change during the cast does not reach them', () => {
    const game = makeSpellGame({ snap: powered(false) });

    game.spells.cast(game.unit(1), game.id.snap);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('hit')),
      ['hit 10 radius 3@1']
    );
  });

  it('reads them again before every hook for a live spell', () => {
    const game = makeSpellGame({ live: powered(true) });

    game.spells.cast(game.unit(1), game.id.live);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('hit')),
      ['hit 20 radius 3@1']
    );
  });

  it('keeps target terms in ctx.scaled for the hit, while ctx.stats holds the caster part', () => {
    const game = makeSpellGame({
      smite: spell({
        activation: { kind: 'trigger' },
        stats: { hit: scaled(5, add('power', 1), add('maxHealth', 0.1, { from: 'target' })) },
        target: (_ctx, input) => input,
        release: (ctx, target) => [damage<Game>(ctx.scaled.hit, { to: target, spell: ctx.spell })]
      })
    });

    const [a, b] = [game.unit(1), game.unit(2)];

    b.stats[STATS.id.maxHealth] = 200;
    game.spells.cast(a, game.id.smite, { input: b });
    assert.equal(b.hp, 100 - (5 + 10 + 20));
  });

  it("answers the damage pipeline's share lookup from the spell's scaling", () => {
    const game = makeSpellGame({
      plain: spell({
        activation: { kind: 'trigger' },
        target: (_ctx, input) => input,
        release: (ctx, target) => [damage<Game>(10, { to: target, spell: ctx.spell })]
      }),
      flat: spell({
        activation: { kind: 'trigger' },
        scaling: { damage: 0 },
        target: (_ctx, input) => input,
        release: (ctx, target) => [damage<Game>(10, { to: target, spell: ctx.spell })]
      })
    });

    const [a, b, c] = [game.unit(1), game.unit(2), game.unit(3)];

    a.stats[STATS.id.damage] = 1.5;
    game.spells.cast(a, game.id.plain, { input: b });
    game.spells.cast(a, game.id.flat, { input: c });
    assert.deepEqual([b.hp, c.hp], [85, 90]);
    assert.equal(game.spells.shareOf(game.id.flat, STATS.id.damage), 0);
    assert.equal(game.spells.shareOf(game.id.plain, STATS.id.damage), undefined);
  });
});

describe('keys and random streams', () => {
  it('keys each cast by (startTick, casterId, spellId, targetId, index, ordinal)', () => {
    const keys: (readonly number[])[] = [];

    const game = makeSpellGame({
      bolt: spell({
        activation: { kind: 'trigger' },

        release: (ctx) => {
          keys.push([...ctx.key()], [...ctx.key(9, 2)]);

          return undefined;
        }
      })
    });

    game.step(3);
    const caster = game.unit(4);

    game.spells.cast(caster, game.id.bolt);
    game.spells.cast(caster, game.id.bolt);
    assert.deepEqual(keys, [
      [3, 4, 0, 0, 0, 0],
      [3, 4, 0, 9, 2, 0],
      [3, 4, 0, 0, 0, 1],
      [3, 4, 0, 9, 2, 1]
    ]);
  });

  it("draws a keyed stream from the cast's key, so a roll depends on nothing drawn before it, and same-tick casts apart", () => {
    const draws: number[] = [];

    const game = makeSpellGame({
      bolt: spell({
        activation: { kind: 'trigger' },

        release: (ctx) => {
          draws.push(ctx.random('crit')(), ctx.random('main')());

          return undefined;
        }
      })
    });

    const a = game.unit(1);

    game.spells.cast(a, game.id.bolt);
    game.spells.cast(a, game.id.bolt);
    assert.equal(draws[0], rollKey(7, 2, [0, 1, 0, 0, 0, 0, 0]));
    assert.equal(draws[2], rollKey(7, 2, [0, 1, 0, 0, 0, 1, 0]));
    assert.notEqual(draws[2], draws[0]);
    assert.notEqual(draws[3], draws[1]);
  });
});

describe('spell events and the cast aura', () => {
  it('raises spell events that triggers hear, filtered by spell, tag and outcome', () => {
    const game = makeSpellGame(
      {
        bolt: spell({ activation: { kind: 'trigger' }, tags: ['fire'], release: () => undefined }),
        punch: spell({ activation: { kind: 'trigger' }, tags: ['melee'], release: () => undefined })
      },
      {
        auras: {
          pyro: aura({
            duration: 'infinite',
            triggers: [
              { on: 'spellRelease', when: [{ filter: 'tag', arg: 'fire' }], do: [mark('fire')] },
              {
                on: 'spellEnd',
                when: [
                  { filter: 'spell', arg: 'punch' },
                  { filter: 'outcome', arg: 'released' }
                ],
                do: [mark('punched')]
              }
            ]
          })
        }
      }
    );

    const a = game.unit(1);

    game.auras.apply(a, game.auraId.pyro);
    game.spells.cast(a, game.id.bolt);
    game.spells.cast(a, game.id.punch);
    assert.deepEqual(
      game.log.filter((line) => line.includes('@1') && !line.includes(' ')),
      ['fire@1', 'punched@1']
    );
  });
});

describe('hooks and procs', () => {
  it('runs the procs a hook pushed into its reusable list, returned or not, as one list', () => {
    const game = makeSpellGame({
      pushed: spell({
        activation: { kind: 'trigger' },
        begin: (_ctx, _target, out) => out.push(mark('one')).push(mark('two')),

        release: (_ctx, _target, out) => {
          out.push(mark('three'));

          return undefined;
        }
      })
    });

    const report = game.spells.cast(game.unit(1), game.id.pushed);

    assert.deepEqual(
      game.log.filter((line) => !line.includes(' ')),
      ['one@1', 'two@1', 'three@1']
    );
    assert.equal(report.went, 1);
  });

  it("credits a cast's procs to its source, and lets a hook apply one and read its outcome", () => {
    const sources: number[] = [];

    const game = makeSpellGame({
      bolt: spell({
        activation: { kind: 'trigger' },

        release: (ctx) => {
          sources.push(ctx.apply(run('read', (proc) => sources.push(proc.source))).amount);

          return [run('read', (proc) => sources.push(proc.source))];
        }
      })
    });

    game.spells.cast(game.unit(1), game.id.bolt, { source: 40 });
    assert.deepEqual(sources, [40, 0, 40]);
  });
});
