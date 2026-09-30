import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOMBSTONE } from '../../src/core/index.ts';
import {
  checkCueSpec,
  createCueBuffer,
  type CueEvent,
  cuePath,
  type CueSpecOf,
  defineCue,
  defineCues,
  fireCue,
  NO_ENTITY,
  setCuePath,
} from '../../src/cues/index.ts';

/** A neutral cue table: one cue per anchor, and a retired slot. */
const TABLE = {
  struck: defineCue({ anchor: 'entity', params: { amount: { kind: 'int' }, heavy: { kind: 'uint8', default: 1 } } }),
  flare: defineCue({
    anchor: 'target',
    params: { reach: { kind: 'fixed', scale: 10, default: 2 }, aim: { kind: 'vec2' }, trail: { kind: 'vec2[]' } },
  }),
  gong: defineCue({ anchor: 'world', params: { pitch: { kind: 'uint8' } } }),
  step: defineCue({ anchor: 'self', isPredicted: true }),
  retired: TOMBSTONE,
} as const;

const CUES = defineCues(TABLE);

/** A place the tests fire at: owner 7, entity 9, at (1, 2). */
const PLACE = { owner: 7, entity: 9, x: 1, z: 2 };

/** An event's placement and key, as one tuple. */
const head = (event: CueEvent) => [event.cue, event.owner, event.entity, event.x, event.z, event.key];

describe('the cue buffer', () => {
  it('appends fresh events in firing order: nobody at the origin, no key, every param at its default', () => {
    const out = createCueBuffer(CUES);
    const first = out.emit(CUES.id.struck);
    const second = out.emit(CUES.id.flare);

    assert.equal(out.count, 2);
    assert.equal(out.events[0], first);
    assert.equal(out.events[1], second);
    assert.deepEqual(head(first), [0, NO_ENTITY, NO_ENTITY, 0, 0, 0]);
    assert.deepEqual(Array.from(first.values.subarray(0, 2)), [0, 1]);
    assert.deepEqual(Array.from(second.values.subarray(0, 5)), [2, 0, 0, 0, 0]);
    assert.equal(first.values.length, CUES.slots);
  });

  it('keeps its records across clears, so a steady-state tick makes none, and resets a reused one', () => {
    const out = createCueBuffer(CUES);

    for (let tick = 0; tick < 3; tick++) {
      const event = out.emit(CUES.id.struck);

      assert.equal(event.values[CUES.params.struck.heavy], 1);
      event.owner = 4;
      event.values[CUES.params.struck.heavy] = 3;
      out.emit(CUES.id.gong);
      out.clear();
    }

    assert.equal(out.count, 0);
    assert.equal(out.created, 2);
  });

  it('refuses a retired or unknown cue id', () => {
    const out = createCueBuffer(CUES);

    assert.throws(() => out.emit(CUES.id.retired), /Cue 4 is not a live cue id/);
    assert.equal(out.count, 0);
  });
});

describe('fireCue', () => {
  it('places each anchor: self on its owner, entity on its entity, target at the point, world nobody', () => {
    const out = createCueBuffer(CUES);

    fireCue(out, { cue: CUES.id.step }, PLACE);
    fireCue(out, { cue: CUES.id.struck }, PLACE);
    fireCue(out, { cue: CUES.id.flare }, PLACE);
    fireCue(out, { cue: CUES.id.gong }, PLACE);

    assert.deepEqual(out.events.slice(0, out.count).map(head), [
      [3, 7, 7, 1, 2, 0],
      [0, 7, 9, 1, 2, 0],
      [1, 7, NO_ENTITY, 1, 2, 0],
      [2, NO_ENTITY, NO_ENTITY, 1, 2, 0],
    ]);
  });

  it("takes the spec's point over the place's, and its key", () => {
    const out = createCueBuffer(CUES);
    const event = fireCue(out, { cue: CUES.id.step, at: { x: -3, z: 4 }, key: 12 }, PLACE);

    assert.deepEqual(head(event), [3, 7, 7, -3, 4, 12]);
  });

  it('writes each param by its kind, leaving the rest at their defaults', () => {
    const out = createCueBuffer(CUES);

    const spec: CueSpecOf<typeof TABLE> = {
      cue: CUES.id.flare,
      params: {
        aim: { x: 0.5, z: -0.5 },
        trail: [
          { x: 1, z: 1 },
          { x: 2, z: 0 },
        ],
      },
    };

    const event = fireCue(out, spec, PLACE);

    assert.deepEqual(Array.from(event.values.subarray(0, 5)), [2, 0.5, -0.5, 0, 2]);
    assert.deepEqual(cuePath(event, CUES.params.flare.trail), [
      { x: 1, z: 1 },
      { x: 2, z: 0 },
    ]);
  });

  it('types a spec by its cue id: only its own params, each of its kind', () => {
    const specs: CueSpecOf<typeof TABLE>[] = [
      { cue: CUES.id.struck, params: { amount: 3 } },
      // @ts-expect-error: the struck cue has no reach param.
      { cue: CUES.id.struck, params: { reach: 3 } },
      // @ts-expect-error: aim is a point, not a number.
      { cue: CUES.id.flare, params: { aim: 3 } },
    ];

    assert.equal(specs.length, 3);
  });

  it('ignores a param the cue does not declare, and refuses a value of the wrong kind', () => {
    const out = createCueBuffer(CUES);

    assert.equal(fireCue(out, { cue: CUES.id.gong, params: { volume: 3 } }, PLACE).values[0], 0);
    assert.throws(() => fireCue(out, { cue: CUES.id.flare, params: { aim: 3 } }, PLACE), /param aim was given/);
    assert.throws(() => fireCue(out, { cue: CUES.id.flare, params: { trail: { x: 1, z: 1 } } }, PLACE), /trail/);
    assert.throws(() => fireCue(out, { cue: CUES.id.flare, params: { reach: [] } }, PLACE), /reach/);
  });

  it('keeps an event writable until the buffer is cleared, so a game can correct it', () => {
    const out = createCueBuffer(CUES);
    const event = fireCue(out, { cue: CUES.id.struck, params: { amount: 5 } }, PLACE);

    fireCue(out, { cue: CUES.id.gong }, PLACE);
    event.values[CUES.params.struck.amount] = 9;

    assert.equal(out.events[0]?.values[CUES.params.struck.amount], 9);
  });
});

describe('lists of points', () => {
  it('copies the points into the event, so the caller may reuse its array; writing again replaces them', () => {
    const out = createCueBuffer(CUES);
    const event = out.emit(CUES.id.flare);
    const points = [{ x: 1, z: 2 }];

    setCuePath(event, CUES.params.flare.trail, points);
    points.push({ x: 3, z: 4 });
    assert.deepEqual(cuePath(event, CUES.params.flare.trail), [{ x: 1, z: 2 }]);

    setCuePath(
      event,
      CUES.params.flare.trail,
      Array.from({ length: 40 }, (_unused, i) => ({ x: i, z: -i })),
    );
    assert.equal(cuePath(event, CUES.params.flare.trail).length, 40);
    assert.deepEqual(cuePath(event, CUES.params.flare.trail).at(-1), { x: 39, z: -39 });
  });

  it('refuses an event that no buffer made', () => {
    const event = { ...createCueBuffer(CUES).emit(CUES.id.flare) };

    assert.throws(() => {
      setCuePath(event, CUES.params.flare.trail, []);
    }, /must come from a cue buffer/);
  });
});

describe('checkCueSpec', () => {
  /** Checks a spec as a spell's would be, as a function for `assert.throws`. */
  const check = (spec: Parameters<typeof checkCueSpec>[1]) => () => {
    checkCueSpec(CUES, spec, 'a spell');
  };

  it('passes a live cue with its own params of their kinds', () => {
    assert.doesNotThrow(check({ cue: CUES.id.flare, params: { reach: 1, aim: { x: 0, z: 1 }, trail: [] } }));
    assert.doesNotThrow(check({ cue: CUES.id.step, key: 3 }));
  });

  it('refuses a dead cue, an unknown param, a value of the wrong kind and a key on a cue not predicted', () => {
    assert.throws(check({ cue: CUES.id.retired }), /a spell: 4 is not a live cue id/);
    assert.throws(check({ cue: CUES.id.gong, params: { volume: 1 } }), /a spell: cue gong has no param volume/);
    assert.throws(check({ cue: CUES.id.flare, params: { aim: 1 } }), /cue flare's param aim takes a vec2/);
    assert.throws(check({ cue: CUES.id.flare, params: { trail: { x: 0, z: 0 } } }), /param trail takes a vec2\[\]/);
    assert.throws(check({ cue: CUES.id.gong, key: 1 }), /cue gong is not predicted, so it takes no key/);
  });
});
