import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  andThen,
  applyAura,
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  escapeReport,
  grant,
  group,
  pickOne,
  type Proc,
  type ProcOutcome,
  raise,
  removeAura,
  removeByTag,
  run
} from '../../src/procs/index.ts';
import { aura, type Game, makeGame, scripted, STRIKE, TAGS } from '../helpers/trigger-game.ts';

const defs = {
  ward: aura({ duration: 4, tags: ['magic'] }),
  hex: aura({ duration: 4, tags: ['curse'], blockedBy: ['magic'] }),
  stack: aura({ duration: 4, stacking: 'stack', maxStacks: 9 })
};

describe('an applyAura read as it lands', () => {
  it('takes its length, stacks and value from the list, in place of its own numbers', () => {
    const { procs, unit, auras, id } = makeGame(defs);
    const [u, v] = [unit(1), unit(2)];
    const of = (ctx: { readonly target: { readonly id: number } }) => ctx.target.id;

    for (const target of [u, v]) {
      procs.run(
        [
          applyAura<Game>('stack', {
            stacks: 1,
            durationOf: (ctx) => of(ctx) * 2,
            stacksOf: (ctx) => of(ctx) + 1,
            valueFrom: (ctx) => of(ctx) * 10
          })
        ],
        { self: target }
      );
    }

    const views = [u, v].map((target) => auras.find(target, id.stack));

    assert.deepEqual(
      views.map((view) => [view?.duration, view?.stacks, view?.value]),
      [
        [2, 2, 10],
        [4, 3, 20]
      ]
    );
  });
});

describe('a proc list applies in order', () => {
  it('lets each proc see what the ones before it did', () => {
    const { procs, unit, log, auras, id } = makeGame(defs);
    const u = unit(1);

    procs.run(
      [
        applyAura('ward'),
        andThen<Game>((ctx) => (ctx.auras.has(ctx.target, id.ward) ? [grant('gold', 1)] : [grant('shards', 1)])),
        removeAura('ward'),
        andThen<Game>((ctx) => (auras.has(ctx.target, id.ward) ? [grant('gold', 2)] : [grant('shards', 2)]))
      ],
      { self: u }
    );
    assert.deepEqual(log, ['grant 0x1@1', 'grant 1x2@1']);
  });

  it('returns how many procs went off and reports each outcome to ctx.apply', () => {
    const { procs, unit } = makeGame(defs);
    const u = unit(1);
    const seen: ProcOutcome['status'][] = [];

    const went = procs.run(
      [
        applyAura('ward'),
        andThen<Game>((ctx) => {
          seen.push(ctx.apply(applyAura('hex')).status, ctx.apply(removeAura('stack')).status);
          seen.push(ctx.apply(removeByTag('magic')).status, ctx.apply(applyAura('hex')).status);

          return undefined;
        }),
        removeAura('stack')
      ],
      { self: u }
    );

    assert.deepEqual(seen, ['refused', 'skipped', 'landed', 'landed']);
    // The andThen returned no procs, so it counts as skipped: what its function applied itself is not its own.
    assert.equal(went, 1);
  });

  it('does nothing with a proc aimed at a unit the same list already killed', () => {
    const { procs, unit, log, auras, id } = makeGame(defs);
    const a = unit(1);
    const b = unit(2);

    procs.run(
      [
        { kind: 'strike', amount: 60, to: b },
        { kind: 'strike', amount: 60, to: b },
        { kind: 'strike', amount: 60, to: b },
        applyAura('stack', { to: b }),
        applyAura('stack', { to: a })
      ],
      { self: a }
    );
    assert.deepEqual(log, ['strike 60@2', 'strike 60@2']);
    assert.equal(auras.has(b, id.stack), false);
    assert.equal(auras.has(a, id.stack), true);
    procs.run([applyAura('stack', { to: b })], { self: a });
    assert.equal(auras.has(b, id.stack), true);
  });

  it('passes over an entry left undefined, so a reused list filled up to a count runs as it is', () => {
    const { procs, unit, log } = makeGame(defs);
    const a = unit(1);
    const b = unit(2);

    const reused: (Proc<Game> | undefined)[] = [
      { kind: 'strike', amount: 60, to: b },
      { kind: 'strike', amount: 60, to: b },
      undefined,
      undefined
    ];

    assert.equal(procs.run(reused, { self: a }), 2);
    assert.deepEqual(log, ['strike 60@2', 'strike 60@2']);
  });

  it('counts a party proc that landed on any member as landed, its members copied before it lands', () => {
    const late: { party?: Game['bearer'][] } = {};

    const { procs, unit, log, party, auras, id } = makeGame({
      ...defs,
      // Leaves the party as it lands.
      leaver: aura({
        duration: 5,

        onLand: (ctx) => {
          late.party?.splice(late.party.indexOf(ctx.bearer), 1);
        }
      })
    });

    late.party = party;

    const [a, b, c] = [unit(1), unit(2), unit(3)];

    // The strike kills c, so the party grant skips it, the last member: still a landing.
    assert.equal(
      procs.run([{ kind: 'strike', amount: 200, to: c }, grant('gold', 1, { to: 'party' })], { self: a }),
      2
    );
    procs.run([applyAura('leaver', { to: 'party' })], { self: a });
    assert.deepEqual(
      [a, b, c].map((each) => auras.has(each, id.leaver)),
      [true, true, true]
    );
    assert.deepEqual(log.slice(0, 3), ['strike 200@3', 'grant 0x1@1', 'grant 0x1@2']);
  });

  it('lands on self, target, eventUnit, the party in party order, or a unit', () => {
    const { procs, unit, log } = makeGame(defs);
    const [a, b, c] = [unit(1), unit(2), unit(3)];

    procs.run(
      [
        grant('gold', 1, { to: 'self' }),
        grant('gold', 2),
        grant('gold', 3, { to: 'eventUnit' }),
        grant('gold', 4, { to: 'party' }),
        grant('gold', 5, { to: a })
      ],
      { self: a, target: b, eventUnit: c }
    );
    procs.run([grant('gold', 6, { to: 'eventUnit' })], { self: a });
    assert.deepEqual(log, [
      'grant 0x1@1',
      'grant 0x2@2',
      'grant 0x3@3',
      'grant 0x4@1',
      'grant 0x4@2',
      'grant 0x4@3',
      'grant 0x5@1'
    ]);
  });
});

describe('chance and groups', () => {
  it('rolls nothing for an always-proc and never applies a proc of chance 0 or less', () => {
    const random = scripted();
    const { procs, unit, log } = makeGame(defs, { procs: { random } });
    const u = unit(1);

    procs.run(
      [
        grant('gold', 1),
        grant('gold', 2, { chance: 1 }),
        grant('gold', 3, { chance: 0 }),
        grant('gold', 4, { chance: -1 })
      ],
      { self: u }
    );
    assert.deepEqual(log, ['grant 0x1@1', 'grant 0x2@1']);
    assert.equal(random.count(), 0);
  });

  it('rolls once per proc below 1, on the procs own stream, a draw below the chance going off', () => {
    const random = scripted([0.49, 0.5, 0.1]);
    const { procs, unit, log } = makeGame(defs, { procs: { random } });
    const u = unit(1);

    procs.run(
      [grant('gold', 1, { chance: 0.5 }), grant('gold', 2, { chance: 0.5 }), grant('gold', 3, { chance: 0.2 })],
      {
        self: u
      }
    );
    assert.deepEqual(log, ['grant 0x1@1', 'grant 0x3@1']);
    assert.equal(random.count(), 3);
  });

  it('puts several procs behind one roll with a group, each keeping its own chance', () => {
    const random = scripted([0.3, 0.9, 0.7]);
    const { procs, unit, log } = makeGame(defs, { procs: { random } });
    const u = unit(1);

    procs.run(
      [
        group([grant('gold', 1), grant('gold', 2, { chance: 0.5 }), grant('gold', 3)], {
          chance: 0.4
        })
      ],
      {
        self: u
      }
    );
    procs.run([group([grant('gold', 4)], { chance: 0.4 })], { self: u });
    assert.deepEqual(log, ['grant 0x1@1', 'grant 0x3@1']);
    assert.equal(random.count(), 3);
  });

  it('asks the game chance rule in place of a draw', () => {
    const asked: [number, number, number][] = [];

    const { procs, unit, log } = makeGame(defs, {
      procs: {
        rollChance: (chance, ctx, index) => {
          asked.push([chance, ctx.self.id, index]);

          return chance > 0.3;
        }
      }
    });

    procs.run([grant('gold', 1, { chance: 0.25 }), grant('gold', 2, { chance: 0.75 }), grant('gold', 3)], {
      self: unit(4)
    });
    // Each roll is told its index in the list, so a keyed rule tells two procs of one list apart.
    assert.deepEqual(asked, [
      [0.25, 4, 0],
      [0.75, 4, 1]
    ]);
    assert.deepEqual(log, ['grant 0x2@4', 'grant 0x3@4']);
  });

  it('draws a pickOne when it applies, after the rolls before it, from the named stream', () => {
    const order: string[] = [];
    const main = scripted([0.1]);

    const { procs, unit, log } = makeGame(defs, {
      procs: {
        random: () => {
          order.push('chance');

          return main();
        },

        streams: (name) => () => {
          order.push(name);

          return 0.7;
        }
      }
    });

    const [a, b, c] = [unit(1), unit(2), unit(3)];

    procs.run(
      [
        grant('gold', 1, { chance: 0.5 }),
        pickOne<Game>(
          () => [a, b, c],
          (_ctx, picked) => [grant('shards', 1, { to: picked })],
          { stream: 'loot' }
        ),
        pickOne<Game>(
          () => [],
          () => [grant('shards', 9)]
        )
      ],
      { self: a }
    );
    assert.deepEqual(order, ['chance', 'loot']);
    assert.deepEqual(log, ['grant 0x1@1', 'grant 1x1@3']);
  });
});

describe('the depth cap', () => {
  it('drops a list nested deeper than maxDepth and counts it', () => {
    const { procs, unit, log } = makeGame(defs, { procs: { maxDepth: 3 } });

    const deeper: Proc<Game> = run<Game>('recurse', (ctx) => {
      ctx.host.log.push(`depth ${ctx.depth}`);
      ctx.run([deeper]);
    });

    procs.run([deeper], { self: unit(1) });
    assert.deepEqual(log, ['depth 1', 'depth 2', 'depth 3']);
    assert.equal(procs.dropped, 1);
    assert.equal(procs.depth, 0);
  });

  it('takes no level for a list whose origin the host fails on', () => {
    const { procs: base, unit, log } = makeGame(defs);

    const procs = createProcSystem<Game>({
      kinds: base.kinds,
      auras: base.auras,
      resources: ['gold', 'shards'],

      host: {
        ...base.host,

        idOf: (each) => {
          if (each.id < 0) {
            throw new Error('no id');
          }

          return each.id;
        }
      }
    });

    for (let i = 0; i < 4; i++) {
      assert.throws(() => procs.run([grant('gold', 1)], { self: unit(-1) }), /no id/);
    }

    assert.equal(procs.depth, 0);
    assert.equal(procs.run([grant('gold', 1)], { self: unit(1) }), 1);
    assert.deepEqual(log, ['grant 0x1@1']);
  });

  it('refuses a depth cap below 1', () => {
    const { procs } = makeGame(defs);

    assert.throws(() =>
      createProcSystem<Game>({
        kinds: procs.kinds,
        auras: procs.auras,
        host: procs.host,
        maxDepth: 0
      })
    );
  });
});

describe('aura hooks run through the proc system', () => {
  it('lands hook procs on the bearer, credited to the aura source', () => {
    const { procs, unit, auras, id } = makeGame({
      ...defs,
      sigil: aura({ duration: 2, onApplied: () => [applyAura('stack', { stacks: 2 })] })
    });

    const u = unit(1);

    auras.apply(u, { aura: id.sigil, source: 7 });
    assert.equal(auras.stacks(u, id.stack), 2);
    assert.equal(auras.find(u, id.stack)?.source, 7);
    assert.equal(procs.depth, 0);
  });
});

describe('names, events and preparing lists at load', () => {
  it('resolves names when a proc applies, and ids pass through', () => {
    const { procs, unit, auras, id } = makeGame(defs);
    const u = unit(1);

    procs.run([applyAura(id.ward), applyAura('stack'), removeByTag(TAGS.id.curse)], { self: u });
    assert.equal(auras.has(u, id.ward), true);
    assert.throws(() => procs.run([applyAura('nothing')], { self: u }), /unknown aura nothing/);
  });

  it('prepares a list: names resolved to ids, every chance checked, errors naming the list', () => {
    const { procs, id } = makeGame(defs);

    assert.deepEqual(procs.prepare([applyAura('hex'), group([removeByTag('curse'), grant('shards', 2)])], 'Pact'), [
      { kind: 'applyAura', aura: id.hex },
      {
        kind: 'group',
        procs: [
          { kind: 'removeByTag', tag: 1 },
          { kind: 'grant', resource: 1, amount: 2 }
        ]
      }
    ]);
    assert.throws(() => procs.prepare([applyAura('hex', { chance: 0 })], 'Pact'), /^RangeError: Pact: a proc's chance/);
    assert.throws(() => procs.prepare([applyAura('nope')], 'Pact'), /Pact: unknown aura nope/);
    assert.throws(
      () => procs.prepare([Object.assign(removeByTag<Game>('curse'), { tag: 'nope' })], 'Pact'),
      /Pact: unknown aura tag nope/
    );
    assert.throws(
      () => procs.prepare([Object.assign(grant<Game>('gold', 1), { resource: 'nope' })], 'Pact'),
      /Pact: unknown resource nope/
    );
    assert.throws(
      () => procs.prepare([Object.assign(applyAura<Game>('hex'), { aura: 99 })], 'Pact'),
      /Pact: 99 is not a live aura id/
    );
    assert.throws(
      () => procs.prepare([Object.assign(grant<Game>('gold', 1), { kind: 'teleport' })], 'Pact'),
      /Pact: Unknown proc kind teleport/
    );
  });

  it('raises an event proc only when the event is heard, filling its payload first', () => {
    const { procs, unit, bus } = makeGame(defs);
    const u = unit(1);
    const heard: number[] = [];

    const fire = raise<{ amount: number }, Game>(bus.kind.hit, (hit) => {
      hit.amount = 33;
    });

    assert.equal(procs.apply(fire, { self: u }).status, 'skipped');
    bus.on(bus.kind.hit, (hit) => heard.push(hit.amount));
    assert.equal(procs.apply(fire, { self: u }).status, 'landed');
    assert.deepEqual(heard, [33]);
  });

  it('reports a replaced core kind as a hatch', () => {
    const { procs } = makeGame(defs);

    const kinds = createProcRegistry<Game>({
      ...CORE_PROCS,
      applyAura: { ...CORE_PROCS.applyAura },
      strike: STRIKE
    });

    const replaced = createProcSystem<Game>({ kinds, auras: procs.auras, host: procs.host });

    assert.deepEqual(escapeReport({ procs: replaced }).procKinds, ['applyAura', 'strike']);
  });

  it('refuses to roll, pick or grant without the stream or host it needs', () => {
    const { procs, unit, bus } = makeGame(defs);

    const bare = createProcSystem<Game>({
      kinds: procs.kinds,
      auras: procs.auras,
      host: { log: [] }
    });

    const u = unit(1);

    assert.throws(() => bare.run([grant('gold', 1, { chance: 0.5 })], { self: u }), /needs a random stream/);
    assert.throws(() => bare.run([grant('gold', 1)], { self: u }), /needs host.grant/);
    assert.throws(() => bare.run([grant('gold', 1, { to: 'party' })], { self: u }), /needs host.party/);
    assert.throws(
      () => bare.run([raise(bus.kind.hit, () => undefined)], { self: u }),
      /needs the proc system to have a bus/
    );
  });
});
