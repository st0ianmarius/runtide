import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraView, ViewOptions } from '../../src/auras/index.ts';
import { against } from '../../src/conditions/index.ts';
import { applyAura, type Proc, raise, removeAura, run } from '../../src/procs/index.ts';
import { explainTriggers } from '../../src/triggers/index.ts';
import { aura, defined, type Game, type HitEvent, KINDS, makeGame, mark, scripted } from '../helpers/trigger-game.ts';

/** A bearer's aura views, in a fresh array. */
const viewsOf = <Bearer>(
  system: { readonly view: (bearer: Bearer, out: AuraView[], options?: ViewOptions) => number },
  bearer: Bearer,
  options?: ViewOptions
): AuraView[] => {
  const out: AuraView[] = [];

  return out.slice(0, system.view(bearer, out, options));
};

describe('dispatch order', () => {
  it('runs the owner, then each party listener in party order; in a bearer, aura order then authored order', () => {
    const game = makeGame({
      alpha: aura({
        duration: 9,
        triggers: [
          { on: 'hit', do: [mark('alpha.0')] },
          { on: 'hit', hears: 'party', do: [mark('alpha.1')] }
        ]
      }),
      beta: aura({ duration: 9, triggers: [{ on: 'hit', hears: 'party', do: [mark('beta.0')] }] }),
      gamma: aura({ duration: 9, triggers: [{ on: 'kill', do: [mark('gamma.0')] }] })
    });

    const [a, b, c] = [game.unit(1), game.unit(2), game.unit(3)];

    for (const unit of [a, b, c]) {
      game.auras.apply(unit, game.id.beta);
      game.auras.apply(unit, game.id.gamma);
      game.auras.apply(unit, game.id.alpha);
    }

    game.hit(b);
    assert.deepEqual(game.log, [
      'alpha.0@2',
      'alpha.1@2',
      'beta.0@2',
      'alpha.1@1',
      'beta.0@1',
      'alpha.1@3',
      'beta.0@3'
    ]);
  });

  it('keeps each trigger event’s own triggers when two share a bus kind: a hit for its attacker, and its victim', () => {
    const game = makeGame({
      onHit: aura({ duration: 9, triggers: [{ on: 'hit', do: [mark('onHit')] }] }),
      onStruck: aura({ duration: 9, triggers: [{ on: 'struck', do: [mark('onStruck')] }] })
    });

    const [a, b] = [game.unit(1), game.unit(2)];

    for (const unit of [a, b]) {
      game.auras.apply(unit, game.id.onHit);
      game.auras.apply(unit, game.id.onStruck);
    }

    game.hit(a, { target: b });
    assert.deepEqual(game.log, ['onHit@1', 'onStruck@2']);
    assert.deepEqual(game.triggers.events, [game.bus.kind.hit]);
  });

  it('hears every party member it found, though one leaves the party as it answers', () => {
    const late: { party?: Game['bearer'][] } = {};

    const leave: Proc<Game> = run('leave', (ctx) => {
      ctx.host.log.push(`leave@${ctx.self.id}`);
      late.party?.splice(late.party.indexOf(ctx.self), 1);
    });

    const game = makeGame({
      ears: aura({ duration: 9, triggers: [{ on: 'hit', hears: 'party', do: [mark('heard'), leave] }] })
    });

    late.party = game.party;

    const [a, b, c] = [game.unit(1), game.unit(2), game.unit(3)];

    game.auras.apply(b, game.id.ears);
    game.auras.apply(c, game.id.ears);
    game.hit(a);
    assert.deepEqual(game.log, ['heard@2', 'leave@2', 'heard@3', 'leave@3']);
  });

  it('gathers before any runs: an aura landed now does not answer, one removed before its turn does not fire', () => {
    const game = makeGame({
      first: aura({
        duration: 9,
        triggers: [{ on: 'hit', do: [mark('first'), applyAura('late'), removeAura('second')] }]
      }),
      second: aura({ duration: 9, triggers: [{ on: 'hit', do: [mark('second')] }] }),
      late: aura({ duration: 9, triggers: [{ on: 'hit', do: [mark('late')] }] })
    });

    const u = game.unit(1);

    game.auras.apply(u, game.id.first);
    game.auras.apply(u, game.id.second);
    game.hit(u);
    game.hit(u);
    assert.deepEqual(game.log, ['first@1', 'first@1', 'late@1']);
  });

  it('answers the unit the event is about, and does nothing for an event about no unit', () => {
    const game = makeGame({
      watch: aura({ duration: 9, triggers: [{ on: 'hit', do: [mark('watch')] }] })
    });

    const [a, b] = [game.unit(1), game.unit(2)];

    game.auras.apply(b, game.id.watch);
    game.hit(a, { target: b });

    const payload = game.bus.payload(game.bus.kind.hit);

    payload.attacker = undefined;
    game.bus.raise(game.bus.kind.hit, payload);
    assert.deepEqual(game.log, []);
  });

  it('lands procs on the owner by default, on the event unit or the party when they say so', () => {
    const game = makeGame({
      banner: aura({
        duration: 9,
        triggers: [
          {
            on: 'hit',
            hears: 'party',
            do: [
              { kind: 'grant', resource: 'gold', amount: 1 },
              { kind: 'grant', resource: 'gold', amount: 2, to: 'eventUnit' },
              { kind: 'grant', resource: 'gold', amount: 3, to: 'party' }
            ]
          }
        ]
      })
    });

    const [a, b] = [game.unit(1), game.unit(2)];

    game.auras.apply(a, game.id.banner);
    game.hit(b);
    assert.deepEqual(game.log, ['grant 0x1@1', 'grant 0x2@2', 'grant 0x3@1', 'grant 0x3@2']);
  });

  it('credits applied auras to the owner', () => {
    const game = makeGame({
      thorns: aura({
        duration: 9,
        triggers: [{ on: 'hit', hears: 'party', do: [applyAura('scar', { to: 'eventUnit' })] }]
      }),
      scar: aura({ duration: 9 })
    });

    const [a, b] = [game.unit(1), game.unit(2)];

    game.auras.apply(a, game.id.thorns);
    game.hit(b);
    assert.equal(game.auras.find(b, game.id.scar)?.source, 1);
  });
});

describe('one trigger: conditions, cooldown, chance, then its procs', () => {
  it('tests filters and conditions in order, and a filter the event does not carry fails', () => {
    const game = makeGame({
      keen: aura({
        duration: 9,
        triggers: [
          {
            on: 'hit',
            when: [
              { filter: 'minAmount', arg: 20 },
              { filter: 'isCrit', arg: 1 }
            ],
            do: [mark('crit')]
          },
          { on: 'hit', when: [{ is: 'healthBelow', arg: 0.5 }], do: [mark('low')] },
          { on: 'kill', when: [{ filter: 'minAmount', arg: 0 }], do: [mark('never')] }
        ]
      })
    });

    const u = game.unit(1);

    game.auras.apply(u, game.id.keen);
    game.hit(u, { amount: 30 });
    game.hit(u, { amount: 10, isCrit: true });
    game.hit(u, { amount: 20, isCrit: true });
    u.hp = 40;
    game.hit(u);

    const kill = game.bus.payload(game.bus.kind.kill);

    kill.killer = u;
    game.bus.raise(game.bus.kind.kill, kill);
    assert.deepEqual(game.log, ['crit@1', 'low@1']);
  });

  it('rolls its chance only below 1 and only after its conditions pass, on the triggers own stream', () => {
    const random = scripted([0.6, 0.2]);

    const game = makeGame(
      {
        luck: aura({
          duration: 9,
          triggers: [
            { on: 'hit', chance: 0.5, when: [{ filter: 'isCrit', arg: 1 }], do: [mark('half')] },
            { on: 'hit', chance: 1, do: [mark('sure')] }
          ]
        })
      },
      { triggers: { random } }
    );

    const u = game.unit(1);

    game.auras.apply(u, game.id.luck);
    game.hit(u);
    game.hit(u, { isCrit: true });
    game.hit(u, { isCrit: true });
    assert.deepEqual(game.log, ['sure@1', 'sure@1', 'half@1', 'sure@1']);
    assert.equal(random.count(), 2);
  });

  it('reads a chance given as a rule from its context as it would fire, clamped, and explains it as live', () => {
    const random = scripted([0.3, 0.3, 0.3]);

    const game = makeGame(
      {
        focus: aura({
          duration: 9,
          stacking: 'stack',
          maxStacks: 9,
          triggers: [{ on: 'hit', chance: (ctx) => ctx.aura.stacks * 0.2, do: [mark('focus')] }]
        })
      },
      { triggers: { random } }
    );

    const u = game.unit(1);

    game.auras.apply(u, game.id.focus);
    game.hit(u);
    game.auras.apply(u, { aura: game.id.focus, stacks: 1 });
    game.hit(u);
    game.auras.apply(u, { aura: game.id.focus, stacks: 5 });
    game.hit(u);
    assert.deepEqual(game.log, ['focus@1', 'focus@1']);
    assert.equal(random.count(), 2);
    assert.equal(explainTriggers(game.triggers, game.id.focus)[0]?.chance, 'live');
  });

  it('draws nothing for a chance read as 0 or not a number', () => {
    const random = scripted([0.5]);

    const game = makeGame(
      {
        dud: aura({ duration: 9, triggers: [{ on: 'hit', chance: () => 0, do: [mark('dud')] }] }),
        odd: aura({ duration: 9, triggers: [{ on: 'hit', chance: () => Number.NaN, do: [mark('odd')] }] })
      },
      { triggers: { random } }
    );

    const u = game.unit(1);

    game.auras.apply(u, game.id.dud);
    game.auras.apply(u, game.id.odd);
    game.hit(u);
    assert.deepEqual([game.log, random.count()], [[], 0]);
  });

  it('checks its cooldown before rolling, so a failed roll never starts it and a running one rolls nothing', () => {
    const random = scripted([0.9, 0.1, 0.1]);

    const game = makeGame(
      {
        spark: aura({
          duration: 99,
          triggers: [{ on: 'hit', chance: 0.5, icd: 0.5, do: [mark('spark')] }]
        })
      },
      { triggers: { random } }
    );

    const u = game.unit(1);
    const cooldown = defined(game.triggers.cooldownOf(game.id.spark, 0));

    game.auras.apply(u, game.id.spark);
    game.hit(u);
    assert.equal(game.auras.has(u, cooldown), false);
    game.hit(u);
    assert.equal(game.auras.remaining(u, cooldown), 0.5);
    game.hit(u);
    game.hit(u);
    assert.equal(random.count(), 2);

    for (let i = 0; i < 4; i++) {
      game.auras.tick(u, 'world');
    }

    game.hit(u);
    assert.deepEqual(game.log, ['spark@1', 'spark@1']);
    assert.equal(random.count(), 3);
  });

  it('keeps the cooldown as an owner-only aura that a cleanse resets', () => {
    const game = makeGame({
      echo: aura({ duration: 99, triggers: [{ on: 'hit', icd: 2, do: [mark('echo')] }] })
    });

    const u = game.unit(1);
    const cooldown = defined(game.triggers.cooldownOf(game.id.echo, 0));

    game.auras.apply(u, game.id.echo);
    game.hit(u);
    game.hit(u);
    assert.deepEqual(
      viewsOf(game.auras, u, { for: 'owner' }).map((view) => view.aura),
      [game.id.echo, cooldown]
    );
    assert.deepEqual(
      viewsOf(game.auras, u).map((view) => view.aura),
      [game.id.echo]
    );
    game.procs.run([{ kind: 'removeByTag', tag: 'cooldown' }], { self: u });
    game.hit(u);
    assert.deepEqual(game.log, ['echo@1', 'echo@1']);
  });

  it('lets the game decide chance and cooldown length', () => {
    const seen: string[] = [];

    const game = makeGame(
      {
        storm: aura({
          duration: 99,
          triggers: [{ on: 'hit', chance: 0.3, icd: 4, do: [mark('storm')] }]
        })
      },
      {
        triggers: {
          rollChance: (chance, ctx) => {
            seen.push(
              `roll ${chance} t${ctx.trigger} #${ctx.index} a${ctx.aura.id} ${ctx.owner.id}/${ctx.eventUnit.id}`
            );

            return true;
          },

          cooldownSeconds: (icd, ctx) => {
            seen.push(`icd ${icd} on ${ctx.owner.id}`);

            return icd / 2;
          }
        }
      }
    );

    const u = game.unit(5);
    const cooldown = defined(game.triggers.cooldownOf(game.id.storm, 0));

    game.auras.apply(u, game.id.storm);
    game.hit(u);
    assert.deepEqual(seen, [`roll 0.3 t0 #0 a${game.id.storm} 5/5`, 'icd 4 on 5']);
    assert.equal(game.auras.remaining(u, cooldown), 2);
  });
});

describe('conditions against the event’s other unit', () => {
  it('asks a condition of the other unit with against, and holds for none when the event has no other unit', () => {
    const game = makeGame({
      finisher: aura({
        duration: 9,
        triggers: [
          { on: 'hit', when: [against({ is: 'healthBelow', arg: 0.5 })], do: [mark('finish')] },
          { on: 'struck', when: [against({ is: 'healthBelow', arg: 2 })], do: [mark('never')] }
        ]
      })
    });

    const u = game.unit(1);
    const target = game.unit(2);

    game.auras.apply(u, game.id.finisher);
    u.hp = 10;
    game.hit(u, { target });
    target.hp = 40;
    game.hit(u, { target });
    game.hit(target, { target: u });
    assert.deepEqual(game.log, ['finish@1']);
  });
});

describe('aura events and nesting', () => {
  it('hears aura changes, with aura and change filters, but never its own aura ending', () => {
    const game = makeGame({
      grief: aura({
        duration: 9,
        triggers: [{ on: 'aura', when: [{ filter: 'change', arg: 'removed' }], do: [mark('grief')] }]
      }),
      mourn: aura({
        duration: 9,
        triggers: [
          {
            on: 'aura',
            when: [
              { filter: 'aura', arg: 'grief' },
              { filter: 'change', arg: 'removed' }
            ],
            do: [mark('mourn')]
          }
        ]
      })
    });

    const u = game.unit(1);

    game.auras.apply(u, game.id.grief);
    game.auras.apply(u, game.id.mourn);
    game.auras.remove(u, game.id.mourn);
    game.auras.apply(u, game.id.mourn);
    game.auras.remove(u, game.id.grief);
    assert.deepEqual(game.log, ['grief@1', 'mourn@1']);
  });

  it('stops nesting at the bus depth cap while subscribers still hear every event', () => {
    const echo = raise<HitEvent, Game>(KINDS.hit, (hit, ctx) => {
      hit.attacker = ctx.self;
      hit.amount = 1;
    });

    const game = makeGame({
      loop: aura({ duration: 9, triggers: [{ on: 'hit', do: [mark('loop'), echo] }] })
    });

    const u = game.unit(1);
    let heard = 0;

    game.bus.on(game.bus.kind.hit, () => {
      heard += 1;
    });
    game.auras.apply(u, game.id.loop);
    game.hit(u);
    assert.deepEqual(game.log, ['loop@1', 'loop@1', 'loop@1']);
    assert.equal(heard, 4);
  });

  it('takes its depth cap from the bus, within the proc depth cap', () => {
    const echo = raise<HitEvent, Game>(KINDS.hit, (hit, ctx) => {
      hit.attacker = ctx.self;
    });

    const loop = {
      loop: aura({ duration: 9, triggers: [{ on: 'hit', do: [mark('loop'), echo] }] })
    } as const;

    const deep = makeGame(loop, { busDepth: 5, procs: { maxDepth: 8 } });
    const capped = makeGame(loop, { busDepth: 5 });

    for (const game of [deep, capped]) {
      const u = game.unit(1);

      game.auras.apply(u, game.id.loop);
      game.hit(u);
    }

    assert.equal(deep.log.length, 5);
    assert.equal(capped.log.length, 4);
    assert.equal(capped.procs.dropped, 1);
  });

  it('stops listening on stop', () => {
    const game = makeGame({
      watch: aura({ duration: 9, triggers: [{ on: 'hit', do: [mark('watch')] }] })
    });

    const u = game.unit(1);

    game.auras.apply(u, game.id.watch);
    game.triggers.stop();
    game.hit(u);
    assert.deepEqual(game.log, []);
    assert.equal(game.bus.hears(game.bus.kind.hit), false);
  });
});
