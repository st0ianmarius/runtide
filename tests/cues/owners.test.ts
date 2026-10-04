import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCueBuffer, cueReaches, defineCue, defineCues, fireCue } from '../../src/cues/index.ts';

/** A pet's cues: one its owner alone sees, one its party sees too. */
const CUES = defineCues({
  growl: defineCue({ anchor: 'self', audience: 'owner' }),
  howl: defineCue({ anchor: 'self', audience: 'party' })
});

/** Player 1 owns pet 10; player 2 shares player 1's party; player 3 is alone. */
const PETS = new Map([[10, 1]]);

/** A recipient for a player, answering `owns` from the pet map and `sharesParty` from the party. */
const player = (id: number) => ({
  id,
  owns: (owner: number) => PETS.get(owner) === id,
  sharesParty: (owner: number) => id !== 3 && (PETS.get(owner) ?? owner) !== 3
});

/** The pet's place: its own entity id is the cue's owner. */
const PET = { owner: 10, entity: 10, x: 0, z: 0 };

describe('cue owners', () => {
  it("delivers a pet's owner-only cue to its owner and no one else", () => {
    const out = createCueBuffer(CUES);
    const growl = fireCue(out, { cue: CUES.id.growl }, PET);

    assert.deepEqual(
      [1, 2, 3].map((id) => cueReaches(CUES, growl, player(id))),
      [true, false, false]
    );
    assert.equal(cueReaches(CUES, growl, { id: 1 }), false);
    assert.equal(cueReaches(CUES, growl, { id: 10 }), true);
  });

  it("delivers a pet's party cue to its owner and the owner's party", () => {
    const out = createCueBuffer(CUES);
    const howl = fireCue(out, { cue: CUES.id.howl }, PET);

    assert.deepEqual(
      [1, 2, 3].map((id) => cueReaches(CUES, howl, player(id))),
      [true, true, false]
    );
    assert.equal(cueReaches(CUES, howl, { id: 1, owns: player(1).owns }), true);
  });

  it('refuses a world cue with an audience other than all', () => {
    for (const audience of ['owner', 'party'] as const) {
      assert.throws(() => defineCues({ horn: defineCue({ anchor: 'world', audience }) }), /world cue has no owner/);
    }

    assert.equal(defineCues({ horn: defineCue({ anchor: 'world', audience: 'all' }) }).size, 1);
  });
});
