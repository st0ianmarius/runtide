import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkOrder } from '../../src/core/index.ts';
import { CORE_PROCS, createProcRegistry, escapeReport, explainProc } from '../../src/procs/index.ts';
import { createMemoryWorld } from '../../src/world/index.ts';
import { aura, type Game, makeGame, mark, STRIKE } from '../helpers/trigger-game.ts';

const CORE_ORDER = [
  'applyAura',
  'removeAura',
  'removeByTag',
  'grant',
  'event',
  'group',
  'andThen',
  'pickOne',
  'run',
  'cue',
  'timeLeft'
];

describe('the proc registry', () => {
  it('gives each kind its id by key order, the core kinds first when spread first', () => {
    const kinds = createProcRegistry<Game>({ ...CORE_PROCS, strike: STRIKE });

    checkOrder(kinds, [...CORE_ORDER, 'strike']);
    assert.equal(kinds.id['strike'], 11);
    assert.equal(kinds.kindOf({ kind: 'andThen' }), 6);
    assert.deepEqual(Array.from(kinds.isTargeted), [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1]);
    assert.equal(kinds.defs[11], STRIKE);
  });

  it('refuses an unknown kind and a kind with no apply', () => {
    const kinds = createProcRegistry<Game>({ ...CORE_PROCS, strike: STRIKE });
    const broken = { ...STRIKE };

    Reflect.deleteProperty(broken, 'apply');
    assert.throws(() => kinds.kindOf({ kind: 'teleport' }), /Unknown proc kind teleport/);
    assert.throws(() => createProcRegistry<Game>({ ...CORE_PROCS, strike: broken }), /strike needs an apply function/);
  });

  it('freezes the kinds, whose functions work detached', () => {
    const { procs, unit, id } = makeGame({ mark: aura({ duration: 1 }) });
    const u = unit(1);
    const { apply } = CORE_PROCS.applyAura;

    assert.equal(Object.isFrozen(procs.kinds.defs[0]), true);
    assert.equal(typeof apply, 'function');
    procs.run([{ kind: 'applyAura', aura: 'mark' }], { self: u });
    assert.equal(procs.auras.has(u, id.mark), true);
  });
});

describe('the escape report', () => {
  it('lists the game kinds and replaced core kinds, and every run hatch with its count', () => {
    const { procs, unit } = makeGame({ mark: aura({ duration: 1 }) });
    const u = unit(1);

    procs.prepare([mark('a'), { kind: 'run', hatch: 'coil.detect', fn: () => undefined }], 'Test list');
    procs.run([mark('b'), mark('c')], { self: u });
    assert.deepEqual(escapeReport({ procs }), {
      procKinds: ['strike'],
      runs: [
        { hatch: 'mark', count: 2 },
        { hatch: 'coil.detect', count: 0 }
      ],
      stages: [],
      activationKinds: [],
      queryExtensions: [],
      slots: []
    });
  });

  it('lists the world’s query extensions', () => {
    const { procs } = makeGame({ mark: aura({ duration: 1 }) });

    const world = createMemoryWorld({ bounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 } }, () => ({
      squareClear: () => true,
      passage: () => undefined
    }));

    assert.deepEqual(escapeReport({ procs, world }).queryExtensions, ['squareClear', 'passage']);
  });
});

describe('explainProc', () => {
  it('explains a proc as data: its kind id, odds, target and numbers, nested procs included', () => {
    const { procs, id } = makeGame({ mark: aura({ duration: 1 }) });

    assert.deepEqual(
      explainProc(procs, {
        kind: 'group',
        chance: 0.25,
        procs: [
          { kind: 'applyAura', aura: 'mark', to: 'eventUnit', duration: 3 },
          { kind: 'strike', amount: 40 },
          { kind: 'grant', resource: 'shards', amount: 2, to: 'party' }
        ]
      }),
      {
        kind: 'proc',
        proc: 5,
        chance: 0.25,
        to: 'none',
        values: {},
        procs: [
          {
            kind: 'proc',
            proc: 0,
            chance: 1,
            to: 'eventUnit',
            values: { aura: id.mark, duration: 3 },
            procs: []
          },
          { kind: 'proc', proc: 11, chance: 1, to: 'target', values: { amount: 40 }, procs: [] },
          {
            kind: 'proc',
            proc: 3,
            chance: 1,
            to: 'party',
            values: { resource: 1, amount: 2 },
            procs: []
          }
        ]
      }
    );
  });
});
