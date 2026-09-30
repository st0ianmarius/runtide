import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCueBuffer, type CueEvent, defineCue, defineCues, NO_ENTITY } from '../../src/cues/index.ts';
import {
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  cue,
  escapeReport,
  explainProc,
  type Proc,
} from '../../src/procs/index.ts';
import { aura, type Game, makeGame, STRIKE } from '../helpers/trigger-game.ts';

/** A neutral cue table: one cue per anchor. */
const CUES = defineCues({
  step: defineCue({ anchor: 'self', params: { size: { kind: 'uint8' } } }),
  struck: defineCue({ anchor: 'entity', params: { amount: { kind: 'int' } } }),
  flare: defineCue({ anchor: 'target', params: { aim: { kind: 'vec2' } } }),
  gong: defineCue({ anchor: 'world' }),
});

/** A test game whose proc system fires into a cue buffer, with three units; unit `n` stands at `(n, −n)`. */
const makeCueGame = () => {
  const out = createCueBuffer(CUES);
  const game = makeGame({ idle: aura({ duration: 1 }) }, { procs: { cues: out } });
  const [a, b, c] = [game.unit(1), game.unit(2), game.unit(3)];

  /** Runs procs for `a` at `b`, about `c`, credited to entity 50; returns the events they fired. */
  const run = (procs: readonly Proc<Game>[]) => {
    out.clear();
    game.procs.run(procs, { self: a, target: b, eventUnit: c, source: 50 });

    return out.events.slice(0, out.count).map(placed);
  };

  return { ...game, out, a, b, c, run };
};

/** An event's cue name, owner, entity and point. */
const placed = (event: CueEvent) => [CUES.name(event.cue), event.owner, event.entity, event.x, event.z];

describe('the cue proc kind (§II.3.9)', () => {
  it("places a self cue on the procs' self, as that unit's", () => {
    const { run } = makeCueGame();

    assert.deepEqual(run([cue<Game>('step')]), [['step', 1, 1, 1, -1]]);
  });

  it("places any other on its unit, the list's target when absent, credited to the list's source", () => {
    const { run } = makeCueGame();

    assert.deepEqual(
      run([
        cue<Game>('struck'),
        cue<Game>('struck', { to: 'eventUnit' }),
        cue<Game>('flare', { to: 'self' }),
        cue<Game>('flare', { at: { x: 5, z: 6 } }),
        cue<Game>('gong', { to: 'eventUnit' }),
      ]),
      [
        ['struck', 50, 2, 2, -2],
        ['struck', 50, 3, 3, -3],
        ['flare', 50, NO_ENTITY, 1, -1],
        ['flare', 50, NO_ENTITY, 5, 6],
        ['gong', NO_ENTITY, NO_ENTITY, 3, -3],
      ],
    );
  });

  it('fires one per party member, in party order', () => {
    const { run } = makeCueGame();

    assert.deepEqual(run([cue<Game>('struck', { to: 'party' })]), [
      ['struck', 50, 1, 1, -1],
      ['struck', 50, 2, 2, -2],
      ['struck', 50, 3, 3, -3],
    ]);
  });

  it('writes its params, and names in data resolve to ids', () => {
    const { out, procs, a } = makeCueGame();

    procs.run(
      [cue<Game>('step', { params: { size: 4 } }), cue<Game>(CUES.id.flare, { params: { aim: { x: 1, z: 0 } } })],
      {
        self: a,
      },
    );

    assert.deepEqual(Array.from(out.events[0]?.values.subarray(0, 1) ?? []), [4]);
    assert.deepEqual(Array.from(out.events[1]?.values.subarray(0, 2) ?? []), [1, 0]);
  });

  it('plays on a unit its list killed, since it changes nothing, and skips a unit the list has not got', () => {
    const { run, procs, out, a } = makeCueGame();

    assert.deepEqual(run([{ kind: 'strike', amount: 500 }, cue<Game>('struck')]), [['struck', 50, 2, 2, -2]]);

    out.clear();
    assert.equal(procs.run([cue<Game>('struck', { to: 'eventUnit' })], { self: a }), 0);
    assert.equal(out.count, 0);
  });

  it('rolls its chance like any proc', () => {
    const { run } = makeCueGame();

    assert.deepEqual(run([cue<Game>('gong', { chance: 0 })]), []);
  });

  it('allocates no event once its buffer has been filled to its size', () => {
    const { run, out } = makeCueGame();
    const list = [cue<Game>('struck', { to: 'party' }), cue<Game>('gong')];

    run(list);

    const made = out.created;

    for (let i = 0; i < 10; i++) {
      run(list);
    }

    assert.equal(out.created, made);
  });

  it('explains itself as its cue id, acting on no unit the runner resolves', () => {
    const { procs } = makeCueGame();

    assert.deepEqual(explainProc(procs, cue<Game>('flare', { to: 'eventUnit' })), {
      kind: 'proc',
      proc: 9,
      chance: 1,
      to: 'none',
      values: { cue: CUES.id.flare },
      procs: [],
    });
    assert.deepEqual(escapeReport({ procs }).procKinds, ['strike']);
  });
});

describe('cue proc validation (§II.6 P7)', () => {
  it('prepares a cue proc to its id', () => {
    const { procs } = makeCueGame();

    assert.deepEqual(procs.prepare([cue<Game>('flare', { to: 'eventUnit' })], 'a trigger'), [
      { kind: 'cue', cue: CUES.id.flare, to: 'eventUnit' },
    ]);
  });

  it("refuses an unknown cue or param, a value of the wrong kind, and a placement its anchor can't take", () => {
    const { procs } = makeCueGame();
    const prepare = (proc: Proc<Game>) => () => procs.prepare([proc], 'a trigger');

    assert.throws(prepare(cue<Game>('thunder')), /a trigger: unknown cue thunder/);
    assert.throws(prepare(cue<Game>(CUES.id.gong, { chance: 2 })), /a trigger: a proc's chance must be in \(0, 1\]/);
    assert.throws(
      prepare(cue<Game>('gong', { params: { pitch: 1 } })),
      /a trigger: a cue proc: cue gong has no param pitch/,
    );
    assert.throws(prepare(cue<Game>('flare', { params: { aim: 1 } })), /param aim takes a vec2/);
    assert.throws(
      prepare(cue<Game>('step', { to: 'eventUnit' })),
      /cue step sits on the procs' self, so it takes no to/,
    );
    assert.throws(prepare(cue<Game>('step', { at: { x: 0, z: 0 } })), /cue step sits on the procs' self/);
    assert.throws(prepare(cue<Game>('struck', { at: { x: 0, z: 0 } })), /cue struck sits on a unit, so it takes no at/);
  });

  it('needs a cue buffer, and a host that knows positions unless the proc names its point', () => {
    const { auras, a } = makeCueGame();
    const kinds = createProcRegistry<Game>({ ...CORE_PROCS, strike: STRIKE });
    const bare = createProcSystem<Game>({ kinds, auras, host: { log: [] } });
    const placeless = createProcSystem<Game>({ kinds, auras, host: { log: [] }, cues: createCueBuffer(CUES) });

    assert.throws(
      () => bare.prepare([cue<Game>('gong')], 'a spell'),
      /a spell: a cue proc needs the proc system to have cues/,
    );
    assert.throws(() => bare.run([cue<Game>(CUES.id.gong)], { self: a }), /This proc needs cues/);
    assert.throws(() => placeless.run([cue<Game>('gong')], { self: a }), /This proc needs host\.positionOf/);
    assert.equal(placeless.run([cue<Game>('gong', { at: { x: 1, z: 1 } })], { self: a }), 1);
  });
});
