import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import {
  createByteReader,
  createByteWriter,
  createCueBuffer,
  createNumberReader,
  createNumberWriter,
  type CueEvent,
  cuePath,
  decodeCues,
  defineCue,
  defineCues,
  encodeCues,
  fireCue
} from '../../src/cues/index.ts';

/** A cue with a param of every kind, and a predicted one. */
const CUES = defineCues(
  {
    flare: defineCue({
      anchor: 'entity',
      params: {
        facing: { kind: 'angle', steps: 4096 },
        reach: { kind: 'fixed', scale: 100, default: 1.5 },
        count: { kind: 'int' },
        heavy: { kind: 'uint8', default: 2 },
        aim: { kind: 'vec2', scale: 20 },
        trail: { kind: 'vec2[]', scale: 10 },
        glow: { kind: 'f32' },
        spell: { kind: 'id' },
        mark: { kind: 'entity' }
      }
    }),
    step: defineCue({ anchor: 'self', isPredicted: true, params: { turn: { kind: 'angle' } } })
  },
  { positionScale: 100 }
);

const P = CUES.params.flare;

/** A finite double within a range. */
const real = (size: number) => fc.double({ min: -size, max: size, noNaN: true });

/** A point within a range. */
const point = fc.record({ x: real(1e5), z: real(1e5) });

/** One generated firing of either cue. */
const firing = fc.record({
  isStep: fc.boolean(),
  owner: fc.integer({ min: -1, max: 1e9 }),
  entity: fc.integer({ min: -1, max: 1e9 }),
  at: point,
  key: fc.integer({ min: 0, max: 2 ** 32 }),
  facing: real(50),
  reach: fc.option(real(1e6), { nil: undefined }),
  count: real(1e9),
  heavy: fc.option(real(400), { nil: undefined }),
  aim: point,
  trail: fc.array(point, { maxLength: 6 }),
  glow: fc.float({ noNaN: true }),
  spell: fc.integer({ min: 0, max: 1e6 }),
  mark: fc.integer({ min: -1, max: 1e6 })
});

/** One generated firing's values. */
type Firing = typeof firing extends fc.Arbitrary<infer Value> ? Value : never;

/** Fires generated firings into a fresh buffer. */
const fireEach = (firings: readonly Firing[]) => {
  const out = createCueBuffer(CUES);

  for (const f of firings) {
    const place = { owner: f.owner, entity: f.entity, x: f.at.x, z: f.at.z };

    if (f.isStep) {
      fireCue(out, { cue: CUES.id.step, key: f.key, params: { turn: f.facing } }, place);
      continue;
    }

    fireCue(
      out,
      {
        cue: CUES.id.flare,
        params: {
          facing: f.facing,
          count: f.count,
          aim: f.aim,
          trail: f.trail,
          glow: f.glow,
          spell: f.spell,
          mark: f.mark,
          ...(f.reach === undefined ? {} : { reach: f.reach }),
          ...(f.heavy === undefined ? {} : { heavy: f.heavy })
        }
      },
      place
    );
  }

  return out;
};

/** Encodes a buffer as numbers. */
const numbersOf = (buffer: ReturnType<typeof createCueBuffer>): number[] => {
  const out = createNumberWriter();

  encodeCues(buffer, out);

  return out.numbers();
};

/** The shortest turn between two angles. */
const turnBetween = (a: number, b: number): number => {
  const turn = Math.abs(a - b) % (2 * Math.PI);

  return Math.min(turn, 2 * Math.PI - turn);
};

/** Whether two numbers are within half a step (and a relative float tolerance for large ones). */
const isNear = (a: number, b: number, step: number): boolean => Math.abs(a - b) <= step / 2 + 1e-9 * Math.abs(b);

/** Checks a decoded flare's list of points: each point within half a step of what was fired. */
const checkTrail = (sent: CueEvent, got: CueEvent) => {
  const trail = cuePath(sent, P.trail);

  for (const [i, at] of cuePath(got, P.trail).entries()) {
    assert.ok(isNear(at.x, trail[i]?.x ?? 0, 0.1) && isNear(at.z, trail[i]?.z ?? 0, 0.1));
  }
};

/** Checks one decoded flare against what was fired: each value within half its step. */
const checkFlare = (sent: CueEvent, got: CueEvent) => {
  const was = (param: number): number => sent.values[param] ?? 0;
  const now = (param: number): number => got.values[param] ?? 0;
  const near = (param: number, step: number) => isNear(now(param), was(param), step);

  assert.ok(turnBetween(now(P.facing), was(P.facing)) <= Math.PI / 4096 + 1e-12);
  assert.ok(near(P.reach, 0.01) && near(P.count, 1) && near(P.aim, 0.05) && near(P.aim + 1, 0.05));
  assert.equal(now(P.heavy), Math.min(255, Math.max(0, Math.round(was(P.heavy)))));
  // A float goes as itself, an infinite one as 0 (JSON writes no infinity).
  assert.equal(now(P.glow), Number.isFinite(was(P.glow)) ? Math.fround(was(P.glow)) + 0 : 0);
  assert.deepEqual([now(P.spell), now(P.mark)], [was(P.spell), was(P.mark)]);
  checkTrail(sent, got);
};

/** Checks one decoded event against what was fired. */
const checkEvent = (sent: CueEvent | undefined, got: CueEvent | undefined) => {
  assert.ok(sent !== undefined && got !== undefined);

  const isStep = sent.cue === CUES.id.step;

  assert.deepEqual([got.cue, got.owner, got.key], [sent.cue, sent.owner, isStep ? sent.key : 0]);
  assert.equal(got.entity, isStep ? sent.owner : sent.entity);
  assert.ok(Math.abs(got.x - sent.x) <= 0.005 + 1e-9 && Math.abs(got.z - sent.z) <= 0.005 + 1e-9);

  if (!isStep) {
    checkFlare(sent, got);
  }
};

describe('cue wire round trips (fast-check)', () => {
  it('reads back every event in order, each value within half its quantisation step', () => {
    fc.assert(
      fc.property(fc.array(firing, { maxLength: 8 }), (firings) => {
        const sent = fireEach(firings);
        const got = createCueBuffer(CUES);

        decodeCues(createNumberReader(numbersOf(sent)), got);
        assert.equal(got.count, sent.count);

        for (let i = 0; i < sent.count; i++) {
          checkEvent(sent.events[i], got.events[i]);
        }
      })
    );
  });

  it('is exact within its quantisation: a decoded batch encodes to the very same numbers', () => {
    fc.assert(
      fc.property(fc.array(firing, { maxLength: 8 }), (firings) => {
        const wire = numbersOf(fireEach(firings));
        const got = createCueBuffer(CUES);

        decodeCues(createNumberReader(wire), got);
        assert.deepEqual(numbersOf(got), wire);
      })
    );
  });

  it('reads the same events from bytes as from numbers', () => {
    fc.assert(
      fc.property(fc.array(firing, { maxLength: 8 }), (firings) => {
        const sent = fireEach(firings);
        const bytes = createByteWriter();
        const fromBytes = createCueBuffer(CUES);
        const fromNumbers = createCueBuffer(CUES);

        encodeCues(sent, bytes);
        decodeCues(createByteReader(bytes.bytes()), fromBytes);
        decodeCues(createNumberReader(numbersOf(sent)), fromNumbers);
        assert.deepEqual(numbersOf(fromBytes), numbersOf(fromNumbers));
      })
    );
  });

  it('sends a param only when its wire form differs from its default, and reads an omitted one as the default', () => {
    fc.assert(
      fc.property(real(10), real(10), (reach, heavy) => {
        const out = createCueBuffer(CUES);
        const got = createCueBuffer(CUES);
        const place = { owner: 1, entity: 2, x: 0, z: 0 };

        fireCue(out, { cue: CUES.id.flare, params: { reach, heavy } }, place);

        const wire = numbersOf(out);
        const mask = wire[6] ?? -1;
        const isReachSent = Math.round(reach * 100) !== 150;
        const isHeavySent = Math.min(255, Math.max(0, Math.round(heavy))) !== 2;

        assert.equal(mask, (isReachSent ? 0b10 : 0) | (isHeavySent ? 0b1000 : 0));
        decodeCues(createNumberReader(wire), got);
        assert.equal(isReachSent || got.events[0]?.values[P.reach] === 1.5, true);
        assert.equal(isHeavySent || got.events[0]?.values[P.heavy] === 2, true);
      })
    );
  });
});
