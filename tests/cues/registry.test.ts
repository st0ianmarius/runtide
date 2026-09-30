import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkOrder, TOMBSTONE } from '../../src/core/index.ts';
import { type CueDef, defineCue, defineCues } from '../../src/cues/index.ts';
import { invalid } from '../helpers/trigger-game.ts';

/** A neutral cue table: one cue per anchor, params of every kind, and a retired slot. */
const TABLE = {
  struck: defineCue({ anchor: 'entity', params: { amount: { kind: 'int' }, heavy: { kind: 'uint8' } } }),
  retired: TOMBSTONE,
  flare: defineCue({
    anchor: 'target',
    audience: 'party',
    params: {
      facing: { kind: 'angle', steps: 360 },
      reach: { kind: 'fixed', scale: 100, default: 1.5 },
      aim: { kind: 'vec2', default: { x: 0.25, z: -1 } },
      trail: { kind: 'vec2[]', scale: 10 },
      glow: { kind: 'f32', default: 0.5 },
      spell: { kind: 'id' },
      mark: { kind: 'entity' },
    },
  }),
  gong: defineCue({ anchor: 'world' }),
  step: defineCue({ anchor: 'self', audience: 'owner', isPredicted: true }),
} as const;

/** One cue definition to refuse, alone in a registry. */
const refused = (def: CueDef) => () => defineCues({ bad: def });

describe('defineCues', () => {
  it('gives each cue its id by key order, a tombstone keeping its slot', () => {
    const cues = defineCues(TABLE);

    checkOrder(cues, ['struck', 'retired', 'flare', 'gong', 'step']);
    assert.deepEqual({ ...cues.id }, { struck: 0, retired: 1, flare: 2, gong: 3, step: 4 });
    assert.equal(cues.isRetired(cues.id.retired), true);
    assert.equal(cues.schemas[1], undefined);
    assert.equal(cues.name(cues.id.flare), 'flare');
  });

  it('builds the anchor, audience and prediction columns', () => {
    const cues = defineCues(TABLE);

    assert.deepEqual(Array.from(cues.columns.anchor), [1, 0, 2, 3, 0]);
    assert.deepEqual(Array.from(cues.columns.audience), [2, 0, 1, 2, 0]);
    assert.deepEqual(Array.from(cues.columns.isPredicted), [0, 0, 0, 0, 1]);
    assert.equal(cues.anchorOf(cues.id.gong), 'world');
    assert.throws(() => cues.anchorOf(cues.id.retired), /retired/);
  });

  it('resolves every param to its first slot at load: a point and a list of points take two', () => {
    const cues = defineCues(TABLE);

    assert.deepEqual({ ...cues.params.struck }, { amount: 0, heavy: 1 });
    assert.deepEqual({ ...cues.params.flare }, { facing: 0, reach: 1, aim: 2, trail: 4, glow: 6, spell: 7, mark: 8 });
    assert.equal(cues.slots, 9);
    assert.equal(cues.paramOf(cues.id.flare, 'glow'), 6);
    assert.equal(cues.paramOf(cues.id.flare, 'size'), undefined);
    assert.equal(cues.paramOf(cues.id.retired, 'glow'), undefined);
  });

  it('compiles each schema: kinds, scales, defaults and their wire forms', () => {
    const schema = defineCues(TABLE, { positionScale: 20 }).schemas[2];

    assert.deepEqual(
      schema?.fields.map((field) => [field.param, field.kind, field.slot, field.scale]),
      [
        ['facing', 4, 0, 360],
        ['reach', 1, 1, 100],
        ['aim', 5, 2, 20],
        ['trail', 6, 4, 10],
        ['glow', 0, 6, 1],
        ['spell', 8, 7, 1],
        ['mark', 7, 8, 1],
      ],
    );
    assert.deepEqual(Array.from(schema?.defaults ?? []), [0, 1.5, 0.25, -1, 0, 0, 0.5, 0, -1]);
    assert.deepEqual(Array.from(schema?.wireDefaults ?? []), [0, 150, 5, -20, 0, 0, 0.5, 0, -1]);
    assert.equal(schema?.size, 9);
  });

  it('freezes the definitions', () => {
    const def = { anchor: 'self', params: { amount: { kind: 'int' } } } as const;

    defineCues({ own: def });
    assert.equal(Object.isFrozen(def), true);
    assert.equal(Object.isFrozen(def.params.amount), true);
  });

  it('refuses an unknown anchor, audience or kind, and more than 30 params', () => {
    assert.throws(refused(invalid(TABLE.gong, { anchor: 'floor' })), /Cue bad: unknown anchor floor/);
    assert.throws(refused(invalid(TABLE.gong, { audience: 'guild' })), /Cue bad: unknown audience guild/);
    assert.throws(
      refused({ anchor: 'self', params: { word: invalid({ kind: 'int' }, { kind: 'text' }) } }),
      /Cue bad: word has no known kind/,
    );

    const params = Object.fromEntries(Array.from({ length: 31 }, (_unused, i) => [`p${i}`, { kind: 'int' as const }]));

    assert.throws(refused({ anchor: 'self', params }), /at most 30 params; it has 31/);
    assert.doesNotThrow(refused({ anchor: 'self', params: Object.fromEntries(Object.entries(params).slice(1)) }));
  });

  it('refuses a scale or steps it cannot quantise with, and a bad position scale', () => {
    assert.throws(refused({ anchor: 'self', params: { r: { kind: 'fixed', scale: 0 } } }), /r needs a scale above 0/);
    assert.throws(refused({ anchor: 'self', params: { p: { kind: 'vec2', scale: Infinity } } }), /p needs a scale/);
    assert.throws(refused({ anchor: 'self', params: { a: { kind: 'angle', steps: 1 } } }), /a needs whole steps/);
    assert.throws(refused({ anchor: 'self', params: { a: { kind: 'angle', steps: 2.5 } } }), /a needs whole steps/);
    assert.throws(() => defineCues({ ok: TABLE.gong }, { positionScale: -1 }), /positionScale must be above 0/);
  });

  it('refuses a default its quantisation does not keep exactly, so an omitted param decodes to it', () => {
    const bad = (param: NonNullable<CueDef['params']>[string]) => refused({ anchor: 'self', params: { v: param } });

    assert.throws(bad({ kind: 'f32', default: 0.1 }), /default of v \(0\.1\) is not a value its quantisation keeps/);
    assert.throws(bad({ kind: 'fixed', scale: 100, default: 0.125 }), /default of v/);
    assert.throws(bad({ kind: 'int', default: 2.5 }), /default of v/);
    assert.throws(bad({ kind: 'uint8', default: 256 }), /default of v/);
    assert.throws(bad({ kind: 'id', default: -1 }), /default of v/);
    assert.throws(bad({ kind: 'angle', default: Math.PI }), /default of v/);
    assert.throws(bad({ kind: 'vec2', default: { x: 0, z: 0.001 } }), /default of v/);
    assert.throws(bad({ kind: 'int', default: Number.NaN }), /default of v/);
    assert.doesNotThrow(bad({ kind: 'f32', default: Math.fround(0.1) }));
    assert.doesNotThrow(bad({ kind: 'angle', steps: 4, default: -Math.PI / 2 }));
    assert.doesNotThrow(bad({ kind: 'fixed', scale: 100, default: 0.3 }));
  });

  it('refuses a predicted cue that depends on an entity id', () => {
    assert.throws(refused({ anchor: 'entity', isPredicted: true }), /predicted cue cannot be anchored to an entity/);
    assert.throws(
      refused({ anchor: 'self', isPredicted: true, params: { who: { kind: 'entity' } } }),
      /predicted cue cannot carry the entity param who/,
    );
  });
});
