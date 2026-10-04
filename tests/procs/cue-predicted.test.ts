import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCueBuffer, defineCue, defineCues } from '../../src/cues/index.ts';
import { cue } from '../../src/procs/index.ts';
import { aura, type Game, makeGame } from '../helpers/trigger-game.ts';

/** A cue table with a predicted cast cue beside a plain one. */
const CUES = defineCues({
  swing: defineCue({ anchor: 'self', isPredicted: true }),
  flash: defineCue({ anchor: 'target' })
});

describe('a predicted cue in a list never prepared', () => {
  it('throws as it fires from procs.run, firing nothing', () => {
    const out = createCueBuffer(CUES);
    const game = makeGame({ idle: aura({ duration: 1 }) }, { procs: { cues: out } });
    const [a, b] = [game.unit(1), game.unit(2)];

    assert.throws(
      () => game.procs.run([cue<Game>('swing')], { self: a, target: b, source: 1 }),
      /^RangeError: cue swing is predicted: a predicted cue is fired by its cast, not by a proc\.$/
    );
    assert.equal(out.count, 0);
    game.procs.run([cue<Game>('flash')], { self: a, target: b, source: 1 });
    assert.equal(out.count, 1, 'a plain cue still fires from an unprepared list');
  });

  it('throws as it fires from an aura hook’s list', () => {
    const out = createCueBuffer(CUES);

    const game = makeGame(
      { flourish: aura({ duration: 1, onApplied: () => [cue<Game>('swing')] }) },
      { procs: { cues: out } }
    );

    assert.throws(() => game.auras.apply(game.unit(1), game.id.flourish), /cue swing is predicted/);
    assert.equal(out.count, 0);
  });
});
