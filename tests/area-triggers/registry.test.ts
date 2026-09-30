import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AnyAreaTriggerDef, defineAreaTrigger, defineAreaTriggers } from '../../src/area-triggers/index.ts';
import { defineTickSlots, TOMBSTONE } from '../../src/core/index.ts';
import { circle, lane } from '../../src/math/index.ts';
import { AREA_TAGS, type Game } from '../helpers/spell-game.ts';

const areaTrigger = defineAreaTrigger<Game>();

/** Two tick slots: the world's, and a late one. */
const SLOTS = defineTickSlots(['world', 'late']);

/** Three neutral kinds: a pool that pulses, a wave that moves, a shield on its owner; one retired slot between. */
const KINDS = () =>
  defineAreaTriggers<Game, 'pool' | 'wave' | 'old' | 'shield'>(
    {
      pool: areaTrigger({ tags: ['pool'], shape: circle(2), lifetime: 4, limit: { perOwner: 3 } }),
      wave: areaTrigger({
        shape: lane({ length: 2, width: 4, dir: 0 }),
        lifetime: 'spent',
        tickIn: SLOTS.id.late,
        insert: 'after-parent',
        expiry: 'clip',
        state: () => ({ passes: 0 }),
        move: () => undefined,
        frame: () => undefined,
      }),
      old: TOMBSTONE,
      shield: areaTrigger({
        tags: ['dome'],
        shape: (c) => circle(c.rank),
        lifetime: (c) => c.rank * 2,
        anchor: 'owner',
        bound: { owner: 'standing', whileDown: 'suspend' },
        limit: { perOwner: (c) => c.rank, replace: 'refuse' },
        onEnd: () => undefined,
      }),
    },
    { tags: AREA_TAGS },
  );

describe('the area trigger registry', () => {
  it('gives each kind its id by key order, a retired slot kept as a tombstone', () => {
    const registry = KINDS();

    assert.deepEqual(registry.id, { pool: 0, wave: 1, old: 2, shield: 3 });
    assert.deepEqual(registry.ids, [0, 1, 3]);
    assert.equal(registry.isRetired(registry.id.old), true);
    assert.throws(() => registry.get(registry.id.old), RangeError);
    assert.equal(registry.kind, 'areaTriggers');
  });

  it('builds the typed columns: slot, flags, lifetime and its kind, expiry and limit', () => {
    const { columns } = KINDS();

    assert.deepEqual([...columns.slot], [0, 1, 0, 0]);
    assert.deepEqual([...columns.flags], [0, 2, 0, 5]);
    assert.deepEqual([...columns.lifetime], [4, Number.POSITIVE_INFINITY, 0, Number.NaN]);
    assert.deepEqual([...columns.lifetimeKind], [0, 2, 0, 3]);
    assert.deepEqual([...columns.expiry], [0, 2, 0, 0]);
    assert.deepEqual([...columns.limit], [3, 0, 0, Number.NaN]);
  });

  it('builds a dispatch table per hook, and the tag bitsets', () => {
    const registry = KINDS();

    assert.deepEqual(Object.keys(registry.hooks), [
      'state',
      'init',
      'move',
      'frame',
      'onContact',
      'onLand',
      'onExpire',
      'onEnd',
    ]);
    assert.equal(registry.hooks.frame[registry.id.wave], registry.get(registry.id.wave).frame);
    assert.deepEqual(
      registry.hooks.onEnd.flatMap((hook, id) => (hook === undefined ? [] : [id])),
      [3],
    );
    assert.deepEqual(registry.tagSets[registry.id.pool]?.toArray(), [AREA_TAGS.id.pool]);
    assert.deepEqual(registry.tagSets[registry.id.shield]?.toArray(), [AREA_TAGS.id.dome]);
  });

  it('freezes the definitions, and leaves their hooks callable detached', () => {
    const registry = KINDS();
    const wave = registry.get(registry.id.wave);
    const { state } = wave;

    assert.equal(Object.isFrozen(wave), true);
    assert.deepEqual(state?.(), { passes: 0 });
  });
});

describe('the load-time checks', () => {
  const refuse = (def: AnyAreaTriggerDef<Game>, message: RegExp): void => {
    assert.throws(() => defineAreaTriggers<Game, 'bad'>({ bad: def }, { tags: AREA_TAGS }), message);
  };

  /** A copy of a definition with one field overwritten, whatever the types say. */
  const forged = (def: AnyAreaTriggerDef<Game>, field: string, value: unknown): AnyAreaTriggerDef<Game> => {
    const copy = { ...def };

    Reflect.set(copy, field, value);

    return copy;
  };

  const base: AnyAreaTriggerDef<Game> = { shape: circle(1), lifetime: 1 };

  it('refuse a lifetime that is not a positive number of seconds, owner, spent or a function', () => {
    refuse({ shape: circle(1), lifetime: 0 }, /Area trigger bad: its lifetime/);
    refuse({ shape: circle(1), lifetime: Number.POSITIVE_INFINITY }, /its lifetime/);
  });

  it('refuse an unknown shape kind, mode or tag', () => {
    refuse(forged(base, 'shape', { kind: 'blob' }), /unknown shape kind blob/);
    refuse(forged(base, 'expiry', 'later'), /its expiry/);
    refuse(forged(base, 'anchor', 'target'), /its anchor/);
    refuse(forged(base, 'tickIn', -1), /tick slot -1/);
    refuse(forged(base, 'tags', ['wall']), /unknown area trigger tag wall/);
  });

  it('refuse a bound that suspends without a standing owner, and a limit below 1', () => {
    refuse({ ...base, bound: { owner: 'present', whileDown: 'suspend' } }, /suspends/);
    refuse({ ...base, limit: { perOwner: 0 } }, /its limit per owner/);
    refuse(forged(base, 'limit', { perOwner: 1, replace: 'newest' }), /its limit replaces/);
  });

  it('refuse a frame order with a repeat or an unknown part, and a bad contact radius', () => {
    refuse({ ...base, order: ['move', 'move'] }, /its order lists/);
    refuse(forged(base, 'order', ['fly']), /its order lists/);
    refuse({ ...base, contact: { radius: -1 } }, /its contact radius/);
  });

  it('refuse a pulse with bad seconds, an unknown reschedule, or no onPulse', () => {
    const onPulse = (): undefined => undefined;

    refuse({ ...base, every: [{ seconds: 0, onPulse }] }, /its pulse 0 beats every/);
    refuse({ ...base, every: [{ seconds: 1, first: -1, onPulse }] }, /its pulse 0 beats every/);
    refuse(forged(base, 'every', [{ seconds: 1, reschedule: 'party', onPulse }]), /has an unknown reschedule/);
    refuse(forged(base, 'every', [{ seconds: 1 }]), /needs an onPulse function/);
  });

  it('refuse a hook or a cue that is not a function', () => {
    refuse(forged(base, 'frame', 3), /frame must be a function/);
    refuse(forged(base, 'cues', { spawn: 1 }), /every cue is a function/);
  });
});
