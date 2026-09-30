import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineTickSlots } from '../../src/core/index.ts';
import { damage } from '../../src/damage/index.ts';
import { applyAura, escapeReport, explainProc, run } from '../../src/procs/index.ts';
import { after, castSpell, CORE_ACTIVATIONS, defineActivationKind, defineActivations } from '../../src/spells/index.ts';
import { aura, type Charged, type Game, makeSpellGame, mark, spell } from '../helpers/spell-game.ts';

/** The test tick slots: delayed procs land in either. */
const SLOTS = defineTickSlots(['early', 'late']);

describe('the castSpell proc', () => {
  it('casts a chained spell through the whole cast order, at the running cast’s rank, credited to its source', () => {
    const game = makeSpellGame({
      swing: spell({ activation: { kind: 'trigger' }, release: () => [castSpell<Game>('stab')] }),
      stab: spell({
        activation: { kind: 'trigger' },
        release: (ctx) => [mark(`stab rank ${ctx.rank} source ${ctx.source}`)]
      })
    });

    game.spells.cast(game.unit(1), game.id.swing, { rank: 3, source: 40 });
    assert.deepEqual(game.log, [
      'start swing@1',
      'start stab@1',
      'stab rank 3 source 40@1',
      'release stab@1',
      'end stab@1 released',
      'release swing@1',
      'end swing@1 released'
    ]);
  });

  it('casts a spell whose own cooldown refuses it while held, landed once a cast started', () => {
    const game = makeSpellGame(
      {
        proc: spell({ activation: { kind: 'trigger' }, release: () => [castSpell<Game>('nova')] }),
        nova: spell({
          activation: { kind: 'trigger' },
          cooldown: { aura: 'icd', seconds: 1 },
          release: () => [mark('nova')]
        }),
        refused: spell({
          activation: { kind: 'trigger' },
          cooldown: { aura: 'icd' },
          canCast: () => false,
          release: () => undefined
        })
      },
      { auras: { icd: aura({ duration: 5 }) } }
    );

    const hero = game.unit(1);
    const icd = game.auraId.icd;

    game.spells.cast(hero, game.id.proc);
    game.spells.cast(hero, game.id.proc);
    assert.deepEqual(
      game.log.filter((line) => line === 'nova@1'),
      ['nova@1']
    );
    assert.equal(game.auras.remaining(hero, icd), 1);
    assert.equal(game.spells.check(hero, game.id.nova), 'cooldown');
    for (let i = 0; i < 4; i++) {
      game.step();
      game.auras.tick(hero, 'world');
    }

    game.spells.cast(hero, game.id.proc);
    assert.equal(game.log.filter((line) => line === 'nova@1').length, 2);

    const other = game.unit(2);
    const refused = game.procs.apply(castSpell<Game>('refused'), { self: other });

    assert.equal(refused.status, 'refused');
    assert.equal(game.auras.has(other, icd), false);
    assert.throws(
      () =>
        makeSpellGame(
          {
            nova: spell({
              activation: { kind: 'trigger' },
              cooldown: { aura: 'icd', seconds: -1 },
              release: () => undefined
            })
          },
          { auras: { icd: aura({ duration: 5 }) } }
        ),
      /its cooldown lasts a finite number of seconds from 0/
    );
    assert.throws(
      () =>
        makeSpellGame({
          nova: spell({
            activation: { kind: 'trigger' },
            cooldown: { aura: 'nope' },
            release: () => undefined
          })
        }),
      /its cooldown aura nope is not a live aura/
    );
  });

  it('is refused when the cast is, and hands the cast its input', () => {
    const outcomes: string[] = [];

    const game = makeSpellGame({
      opener: spell({
        activation: { kind: 'trigger' },
        target: (_ctx, input) => input,

        release: (ctx, target) => {
          outcomes.push(ctx.apply(castSpell<Game>('aimed')).status);
          outcomes.push(ctx.apply(castSpell<Game>('aimed', { inputOf: () => target })).status);

          return undefined;
        }
      }),
      aimed: spell({
        activation: { kind: 'trigger' },
        target: (_ctx, input) => input,
        release: (_ctx, target) => [mark(`aimed at ${target.id}`)]
      })
    });

    game.spells.cast(game.unit(1), game.id.opener, { input: game.unit(2) });
    assert.deepEqual(outcomes, ['refused', 'landed']);
    assert.ok(game.log.includes('aimed at 2@1'));
  });

  it('resolves its spell at load, refusing an unknown one, and explains itself', () => {
    const game = makeSpellGame({
      bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined })
    });

    const [prepared] = game.procs.prepare([castSpell<Game>('bolt', { rank: 2 })], 'combo');

    assert.deepEqual(prepared, { rank: 2, kind: 'castSpell', spell: game.id.bolt });
    assert.throws(() => game.procs.prepare([castSpell<Game>('nope')], 'combo'), /combo: unknown spell nope/);
    assert.deepEqual(explainProc(game.procs, castSpell<Game>('bolt')).values, { spell: 0 });
  });
});

describe('delayed procs', () => {
  /** A game whose `drop` spell schedules its procs later, and a unit that casts it. */
  const dropping = (procs: Parameters<typeof after<Game>>[1], seconds = 0.5) => {
    const game = makeSpellGame({
      drop: spell({
        activation: { kind: 'trigger' },
        target: (_ctx, input) => input,

        release: (_ctx, target) => [after<Game>(seconds, [...procs, damage<Game>(10, { to: target })])]
      })
    });

    return { ...game, a: game.unit(1), b: game.unit(2) };
  };

  it('lands after its seconds, for the origin it was scheduled with', () => {
    const game = dropping([mark('landed')]);

    game.spells.cast(game.a, game.id.drop, { input: game.b });
    assert.equal(game.spells.delayed.pending, 1);
    game.step();
    assert.equal(game.spells.stepDelayed(), 0);
    game.step();
    assert.equal(game.spells.stepDelayed(), 1);
    assert.deepEqual(game.log.at(-1), 'landed@1');
    assert.equal(game.b.hp, 90);
    assert.equal(game.spells.delayed.pending, 0);
  });

  it('keeps its cast alive until it lands, then lets the record go', () => {
    const game = dropping([]);
    const { handle } = game.spells.cast(game.a, game.id.drop, { input: game.b });

    assert.equal(game.spells.isRunning(handle), false);
    assert.equal(game.spells.get(handle)?.outcome, 'released');
    game.step(2);
    game.spells.stepDelayed();
    assert.equal(game.spells.get(handle), undefined);
    assert.equal(game.spells.pool.live, 0);
  });

  it('lands a bound list while its owner passes, and drops it unrun, letting its cast go, once it fails', () => {
    const standing = new Set<number>([1]);

    const game = makeSpellGame({
      strike: spell({
        activation: { kind: 'trigger' },

        release: () => [after<Game>(0.5, [mark('struck')], { bound: (owner) => standing.has(owner.id) })]
      })
    });

    const a = game.unit(1);

    game.spells.cast(a, game.id.strike);
    game.step(2);
    assert.equal(game.spells.stepDelayed(), 1);

    const { handle } = game.spells.cast(a, game.id.strike);

    game.step(2);
    standing.delete(1);
    assert.equal(game.spells.stepDelayed(), 0);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('struck')),
      ['struck@1']
    );
    assert.equal(game.spells.get(handle), undefined);
    assert.equal(game.spells.delayed.pending, 0);
  });

  it("counts a chained delay from its parent's due time with from: 'due', else from now", () => {
    const landed: string[] = [];

    const game = makeSpellGame({
      quake: spell({
        activation: { kind: 'trigger' },

        release: () => [
          after<Game>(0.3, [
            after<Game>(0.3, [run('due', () => landed.push(`due t${game0.clock.tick}`))], {
              from: 'due'
            }),
            after<Game>(0.3, [run('now', () => landed.push(`now t${game0.clock.tick}`))])
          ])
        ]
      })
    });

    const game0 = game;

    game.spells.cast(game.unit(1), game.id.quake);

    for (let tick = 1; tick <= 5; tick++) {
      game.step();
      game.spells.stepDelayed();
    }

    // The parent is due at 0.3 s: tick 2. `due` is due at 0.6 s (tick 3), `now` 0.3 s after tick 2 (tick 4).
    assert.deepEqual(landed, ['due t3', 'now t4']);
  });

  it('lands each tick slot on its own, in scheduling order within a tick', () => {
    const game = makeSpellGame(
      {
        split: spell({
          activation: { kind: 'trigger' },

          release: () => [
            after<Game>(0.25, [mark('late one')], { slot: SLOTS.id.late }),
            after<Game>(0.25, [mark('early one')]),
            after<Game>(0.25, [mark('early two')], { slot: SLOTS.id.early })
          ]
        })
      },
      { spells: { slots: SLOTS } }
    );

    game.spells.cast(game.unit(1), game.id.split);
    game.step();
    assert.equal(game.spells.stepDelayed(SLOTS.id.late), 1);
    assert.equal(game.spells.stepDelayed(SLOTS.id.early), 2);
    assert.deepEqual(game.log.slice(-3), ['late one@1', 'early one@1', 'early two@1']);
  });

  it('refuses seconds below 0 and a slot the system does not have, at load and when it applies', () => {
    const game = makeSpellGame({
      bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined })
    });

    assert.throws(() => game.procs.prepare([after<Game>(-1, [])], 'x'), /x: an after proc waits/);
    assert.throws(() => game.procs.prepare([after<Game>(1, [], { slot: SLOTS.id.late })], 'x'), /slot 1/);
    assert.throws(() => game.procs.run([after<Game>(Number.NaN, [])], { self: game.unit(1) }), /after proc waits/);
  });

  it('makes no new records in a steady state', () => {
    const game = dropping([]);

    for (let i = 0; i < 20; i++) {
      game.spells.cast(game.a, game.id.drop, { input: game.b });
      game.step(2);
      game.spells.stepDelayed();
    }

    assert.equal(game.spells.delayed.created, 1);
    assert.equal(game.spells.pool.created, 1);
  });
});

describe('the escape report', () => {
  it('counts the spell kinds as the framework’s own, and lists the game’s activation kinds', () => {
    const charged = defineActivationKind<Charged, Game>({});

    const game = makeSpellGame(
      { bolt: spell({ activation: { kind: 'charged', least: 1 }, release: () => undefined }) },
      { activations: defineActivations<Game>({ ...CORE_ACTIVATIONS, charged }) }
    );

    const { procs, damage, spells, areaTriggers } = game;
    const report = escapeReport({ procs, damage, spells, areaTriggers });

    assert.deepEqual(report.procKinds, []);
    assert.deepEqual(report.activationKinds, ['charged']);
    assert.deepEqual(escapeReport({ procs, damage, areaTriggers }).procKinds, ['castSpell', 'after', 'rescaleClocks']);
    assert.deepEqual(escapeReport({ procs, damage, spells }).procKinds, ['spawn', 'despawnOwned']);
  });
});

describe('the cast a proc list belongs to', () => {
  it('credits an aura’s hooks to no cast, even while a cast lands the aura', () => {
    const game = makeSpellGame(
      {
        bolt: spell({
          activation: { kind: 'trigger' },
          target: (ctx) => ctx.input,
          release: (_ctx, target) => (target === undefined ? undefined : [applyAura<Game>('thorns', { to: target })])
        }),
        retort: spell({ activation: { kind: 'trigger' }, release: (ctx) => [mark(`retort rank ${ctx.rank}`)] })
      },
      {
        auras: {
          thorns: aura({
            duration: 'infinite',
            onApplied: () => [after<Game>(1, [mark('late')]), castSpell<Game>('retort')]
          })
        }
      }
    );

    const hero = game.unit(1);
    const victim = game.unit(100);

    game.spells.cast(hero, game.id.bolt, { input: victim, rank: 5 });
    assert.ok(game.log.includes('retort rank 1@100'));
    assert.equal(game.spells.withdrawDelayed(hero), 0);
    assert.equal(game.spells.withdrawDelayed(victim), 1);
  });
});
