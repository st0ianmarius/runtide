import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createByteReader,
  createByteWriter,
  createCueBuffer,
  createNumberReader,
  createNumberWriter,
  type CueEvent,
  cuePath,
  decodeCueParams,
  decodeCues,
  defineCue,
  defineCues,
  encodeCueParams,
  encodeCues,
  fireCue,
  NO_ENTITY,
} from '../../src/cues/index.ts';

/** A neutral cue table: one cue per anchor, a predicted one, and params of every kind. */
const CUES = defineCues({
  hurt: defineCue({ anchor: 'self', audience: 'owner', params: { amount: { kind: 'int' } } }),
  struck: defineCue({ anchor: 'entity', params: { amount: { kind: 'int' }, heavy: { kind: 'uint8', default: 1 } } }),
  flare: defineCue({
    anchor: 'target',
    params: {
      facing: { kind: 'angle', steps: 360 },
      reach: { kind: 'fixed', scale: 10, default: 2 },
      aim: { kind: 'vec2' },
      trail: { kind: 'vec2[]', scale: 10 },
      glow: { kind: 'f32' },
      spell: { kind: 'id' },
      mark: { kind: 'entity' },
    },
  }),
  gong: defineCue({ anchor: 'world' }),
  step: defineCue({ anchor: 'self', isPredicted: true }),
});

/** The five test events, one per cue, fired in order into a fresh buffer. */
const fireAll = () => {
  const out = createCueBuffer(CUES);

  fireCue(out, { cue: CUES.id.hurt, params: { amount: 12 } }, { owner: 3, entity: 3, x: 1.234, z: -5 });
  fireCue(out, { cue: CUES.id.struck }, { owner: 3, entity: 9, x: 1, z: 2 });
  fireCue(out, { cue: CUES.id.gong }, { owner: 3, entity: NO_ENTITY, x: 0.5, z: 0 });
  fireCue(out, { cue: CUES.id.step, key: 42 }, { owner: 2, entity: 2, x: 0, z: 0 });
  fireCue(
    out,
    {
      cue: CUES.id.flare,
      params: {
        facing: -Math.PI / 2,
        aim: { x: 0.5, z: -0.25 },
        trail: [
          { x: 1, z: 1 },
          { x: 2.5, z: -3 },
        ],
        glow: 0.1,
        spell: 4,
        mark: 7,
      },
    },
    { owner: 3, entity: 9, x: 1, z: 2 },
  );

  return out;
};

/** An event as one flat tuple: its placement and key, then its own slots. */
const flat = (event: CueEvent | undefined) => {
  if (event === undefined) {
    return [];
  }

  const size = CUES.schemas[event.cue]?.size ?? 0;

  return [event.cue, event.owner, event.entity, event.x, event.z, event.key, ...event.values.subarray(0, size)];
};

/** Every event of a buffer, flat. */
const flatAll = (buffer: ReturnType<typeof createCueBuffer>) => buffer.events.slice(0, buffer.count).map(flat);

describe('the cue wire layout', () => {
  it('writes each event as its id, owner, entity, point, key and the params that differ from their defaults', () => {
    const out = createNumberWriter();

    assert.equal(encodeCues(fireAll(), out), 5);
    assert.deepEqual(
      out.numbers(),
      [
        [5],
        [0, 4, 123, -500, 0b1, 12],
        [1, 4, 10, 100, 200, 0],
        [3, 50, 0, 0],
        [4, 3, 0, 0, 42, 0],
        [2, 4, 100, 200, 0b111_1101, 270, 50, -25, 2, 10, 10, 15, -40, Math.fround(0.1), 4, 8],
      ].flat(),
    );
  });

  it('packs the same numbers into bytes: LEB128 varints, zigzag for signed ones, float32 little-endian', () => {
    const out = createCueBuffer(CUES);
    const bytes = createByteWriter(4);

    fireCue(out, { cue: CUES.id.gong }, { owner: 3, entity: NO_ENTITY, x: 0.5, z: 0 });
    fireCue(out, { cue: CUES.id.hurt, params: { amount: -300 } }, { owner: 200, entity: 200, x: -0.01, z: 0 });
    fireCue(out, { cue: CUES.id.flare, params: { glow: 0.5 } }, { owner: NO_ENTITY, entity: NO_ENTITY, x: 0, z: 0 });
    encodeCues(out, bytes);

    assert.deepEqual(
      Array.from(bytes.bytes()),
      [[3], [3, 100, 0, 0], [0, 201, 1, 1, 0, 1, 215, 4], [2, 0, 0, 0, 0b1_0000, 0, 0, 0, 63]].flat(),
    );
  });

  it('reads both forms back into a buffer, in order, each value as its quantisation keeps it', () => {
    const numbers = createNumberWriter();
    const bytes = createByteWriter();
    const fromNumbers = createCueBuffer(CUES);
    const fromBytes = createCueBuffer(CUES);

    encodeCues(fireAll(), numbers);
    encodeCues(fireAll(), bytes);
    assert.equal(decodeCues(createNumberReader(numbers.numbers()), fromNumbers), 5);
    assert.equal(decodeCues(createByteReader(bytes.bytes()), fromBytes), 5);

    const expected = [
      [0, 3, 3, 1.23, -5, 0, 12],
      [1, 3, 9, 1, 2, 0, 0, 1],
      [3, NO_ENTITY, NO_ENTITY, 0.5, 0, 0],
      [4, 2, 2, 0, 0, 42],
      [2, 3, NO_ENTITY, 1, 2, 0, -Math.PI / 2, 2, 0.5, -0.25, 0, 2, Math.fround(0.1), 4, 7],
    ];

    assert.deepEqual(flatAll(fromNumbers), expected);
    assert.deepEqual(flatAll(fromBytes), expected);
    assert.deepEqual(cuePath(fromBytes.events[4] ?? fromBytes.emit(CUES.id.gong), CUES.params.flare.trail), [
      { x: 1, z: 1 },
      { x: 2.5, z: -3 },
    ]);
  });

  it('leaves a param off the wire when its wire form equals its default, and reads it back as the default', () => {
    const out = createCueBuffer(CUES);
    const numbers = createNumberWriter();
    const back = createCueBuffer(CUES);
    const event = fireCue(out, { cue: CUES.id.flare, params: { reach: 2.04, trail: [] } }, { ...ORIGIN });

    encodeCues(out, numbers);
    assert.deepEqual(numbers.numbers(), [1, 2, 0, 0, 0, 0]);

    decodeCues(createNumberReader(numbers.numbers()), back);
    assert.equal(event.values[CUES.params.flare.reach], 2.04);
    assert.equal(back.events[0]?.values[CUES.params.flare.reach], 2);
  });

  it('quantises by kind: rounds, clamps a byte, wraps an angle, and makes NaN 0 and a bad entity nobody', () => {
    const out = createCueBuffer(CUES);
    const back = createCueBuffer(CUES);
    const numbers = createNumberWriter();
    const values = { spell: -2, mark: -5, facing: (3 * Math.PI) / 2, reach: Number.NaN, glow: Number.NaN };

    fireCue(out, { cue: CUES.id.struck, params: { amount: 2.5, heavy: 300 } }, { ...ORIGIN });
    fireCue(out, { cue: CUES.id.struck, params: { amount: -2.5, heavy: -3 } }, { ...ORIGIN });
    fireCue(out, { cue: CUES.id.flare, params: values }, { ...ORIGIN, x: Infinity });
    encodeCues(out, numbers);
    decodeCues(createNumberReader(numbers.numbers()), back);

    assert.deepEqual(flat(back.events[0]).slice(6), [3, 255]);
    assert.deepEqual(flat(back.events[1]).slice(6), [-2, 0]);
    assert.deepEqual(flat(back.events[2]).slice(3, 5), [2 ** 51 / 100, 0]);
    assert.deepEqual(flat(back.events[2]).slice(6), [-Math.PI / 2, 0, 0, 0, 0, 0, Number.NaN, 0, NO_ENTITY]);
  });

  it('writes only the events `admit` picks, counting them first', () => {
    const numbers = createNumberWriter();
    const back = createCueBuffer(CUES);

    assert.equal(
      encodeCues(fireAll(), numbers, (event) => event.owner === 2),
      1,
    );
    decodeCues(createNumberReader(numbers.numbers()), back);
    assert.deepEqual(flatAll(back), [[4, 2, 2, 0, 0, 42]]);
  });

  it("lets a game embed an event's params in its own layout", () => {
    const out = createCueBuffer(CUES);
    const back = createCueBuffer(CUES);
    const numbers = createNumberWriter();
    const event = fireCue(out, { cue: CUES.id.struck, params: { amount: 7 } }, { ...ORIGIN });

    numbers.uint(99);
    encodeCueParams(CUES, event, numbers);
    assert.deepEqual(numbers.numbers(), [99, 1, 7]);

    const reader = createNumberReader(numbers.numbers());
    const copy = back.emit(CUES.id.struck);

    assert.equal(reader.uint(), 99);
    decodeCueParams(CUES, copy, reader);
    assert.deepEqual(flat(copy).slice(6), [7, 1]);
    assert.equal(reader.remaining(), 0);
  });

  it('keeps writing past its first capacity, and starts over on reset', () => {
    const bytes = createByteWriter(1);
    const numbers = createNumberWriter();

    for (let i = 0; i < 100; i++) {
      bytes.uint(2 ** 40);
      bytes.f32(1.5);
      numbers.int(-i);
    }

    assert.equal(bytes.length, 1000);
    assert.equal(numbers.length, 100);
    bytes.reset();
    numbers.reset();
    bytes.uint(5);
    numbers.uint(6);
    assert.deepEqual(Array.from(bytes.bytes()), [5]);
    assert.deepEqual(numbers.numbers(), [6]);
  });
});

describe('reading cue data it cannot trust', () => {
  it('refuses an unknown cue id, stray mask bits, and more events or points than the data holds', () => {
    const into = createCueBuffer(CUES);
    const read = (numbers: readonly number[]) => () => decodeCues(createNumberReader(numbers), into);

    assert.throws(read([1, 9, 0, 0, 0]), /Cue data names cue 9, which is not live/);
    assert.throws(read([1, 0, 1, 0, 0, 0b10, 3]), /marks params cue hurt does not have/);
    assert.throws(read([5, 3, 0, 0, 0]), /claims 5 events it does not hold/);
    assert.throws(read([1, 2, 0, 0, 0, 0b1000, 3, 1, 1]), /claims 3 points it does not hold/);
    assert.throws(read([1, 0, 1, 0]), /Cue data ended/);
  });

  it('refuses a number that is not a whole one where a whole one goes', () => {
    const into = createCueBuffer(CUES);

    assert.throws(() => decodeCues(createNumberReader([1, 3, 0.5, 0, 0]), into), /held 0\.5 where a whole number/);
    assert.throws(() => decodeCues(createNumberReader([-1]), into), /held -1 where a whole number/);
  });

  it('refuses bytes that end inside a number or a float, or hold a number past the safe range', () => {
    const reader = createByteReader(Uint8Array.from([0x80]));

    assert.throws(() => reader.uint(), /Cue data ended in a number/);
    assert.throws(() => createByteReader(Uint8Array.from([1, 2])).f32(), /Cue data ended in a float/);
    assert.throws(() => createByteReader(new Uint8Array(9).fill(0xff)).uint(), /past the safe range/);
  });
});

/** The origin, as a place of nobody's. */
const ORIGIN = { owner: NO_ENTITY, entity: NO_ENTITY, x: 0, z: 0 };
