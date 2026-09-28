import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createCueBuffer,
  createCueEchoes,
  createNumberReader,
  createNumberWriter,
  cueReaches,
  decodeCues,
  defineCue,
  defineCues,
  encodeCues,
  fireCue,
} from '../../src/cues/index.ts';

/** A neutral cue table: one cue per audience, a world cue claiming an owner audience, and two predicted cues. */
const CUES = defineCues({
  mine: defineCue({ anchor: 'self', audience: 'owner' }),
  ours: defineCue({ anchor: 'target', audience: 'party' }),
  all: defineCue({ anchor: 'entity' }),
  horn: defineCue({ anchor: 'world', audience: 'owner' }),
  step: defineCue({ anchor: 'self', isPredicted: true }),
  leap: defineCue({ anchor: 'target', isPredicted: true }),
});

/** Units 1 and 2 share a party; unit 3 is alone. */
const sharesParty = (a: number) => (owner: number) => a !== 3 && owner !== 3;

/** A place of owner 1, at the origin. */
const OWNED = { owner: 1, entity: 1, x: 0, z: 0 };

describe('cueReaches (§II.6 R1)', () => {
  it('routes by audience: the owner alone, the owner and its party, or everyone', () => {
    const out = createCueBuffer(CUES);
    const events = [CUES.id.mine, CUES.id.ours, CUES.id.all, CUES.id.horn].map((cue) => fireCue(out, { cue }, OWNED));
    const reach = (id: number) => events.map((event) => cueReaches(CUES, event, { id, sharesParty: sharesParty(id) }));

    assert.deepEqual(reach(1), [true, true, true, true]);
    assert.deepEqual(reach(2), [false, true, true, true]);
    assert.deepEqual(reach(3), [false, false, true, true]);
    assert.deepEqual(
      events.map((event) => cueReaches(CUES, event, { id: 2 })),
      [false, false, true, true],
    );
  });

  it("is the server's admit: each recipient decodes only what reaches it", () => {
    const out = createCueBuffer(CUES);

    for (const owner of [1, 2, 3]) {
      fireCue(out, { cue: CUES.id.mine }, { ...OWNED, owner });
      fireCue(out, { cue: CUES.id.ours }, { ...OWNED, owner });
    }

    const heard = (id: number) => {
      const numbers = createNumberWriter();
      const got = createCueBuffer(CUES);
      const recipient = { id, sharesParty: sharesParty(id) };

      encodeCues(out, numbers, (event) => cueReaches(CUES, event, recipient));
      decodeCues(createNumberReader(numbers.numbers()), got);

      return got.events.slice(0, got.count).map((event) => `${CUES.name(event.cue)}@${event.owner}`);
    };

    assert.deepEqual(heard(1), ['mine@1', 'ours@1', 'ours@2']);
    assert.deepEqual(heard(3), ['mine@3', 'ours@3']);
  });
});

describe('predicted cue echoes (§II.6 R2)', () => {
  it("drops the server's copy of a cue the client fired ahead, once, matched on cue, owner and key", () => {
    const echoes = createCueEchoes(CUES);
    const mine = createCueBuffer(CUES);
    const server = createCueBuffer(CUES);

    echoes.note(fireCue(mine, { cue: CUES.id.step, key: 5 }, OWNED));
    echoes.note(fireCue(mine, { cue: CUES.id.leap, key: 6 }, OWNED));

    const copies = [
      fireCue(server, { cue: CUES.id.step, key: 5 }, OWNED),
      fireCue(server, { cue: CUES.id.step, key: 5 }, OWNED),
      fireCue(server, { cue: CUES.id.step, key: 6 }, OWNED),
      fireCue(server, { cue: CUES.id.leap, key: 6 }, { ...OWNED, owner: 2 }),
      fireCue(server, { cue: CUES.id.leap, key: 6 }, OWNED),
    ];

    assert.deepEqual(
      copies.map((event) => echoes.isEcho(event)),
      [true, false, false, false, true],
    );
  });

  it('notes nothing without a key or for a cue that is not predicted, and forgets the oldest past its capacity', () => {
    const echoes = createCueEchoes(CUES, 2);
    const out = createCueBuffer(CUES);
    const fire = (key: number) => fireCue(out, { cue: CUES.id.step, key }, OWNED);
    const unkeyed = fire(0);
    const mine = fireCue(out, { cue: CUES.id.mine }, OWNED);

    echoes.note(unkeyed);
    echoes.note(mine);
    assert.equal(echoes.isEcho(unkeyed), false);
    assert.equal(echoes.isEcho(mine), false);

    for (const key of [1, 2, 3]) {
      echoes.note(fire(key));
    }

    assert.deepEqual(
      [1, 2, 3].map((key) => echoes.isEcho(fire(key))),
      [false, true, true],
    );

    echoes.note(fire(4));
    echoes.clear();
    assert.equal(echoes.isEcho(fire(4)), false);
    assert.throws(() => createCueEchoes(CUES, 0), /whole capacity from 1/);
  });

  it('matches a copy that crossed the wire', () => {
    const echoes = createCueEchoes(CUES);
    const mine = createCueBuffer(CUES);
    const server = createCueBuffer(CUES);
    const got = createCueBuffer(CUES);
    const numbers = createNumberWriter();

    echoes.note(fireCue(mine, { cue: CUES.id.step, key: 2 ** 31 }, { ...OWNED, x: 3 }));
    fireCue(server, { cue: CUES.id.step, key: 2 ** 31 }, { ...OWNED, x: 3.001 });
    encodeCues(server, numbers);
    decodeCues(createNumberReader(numbers.numbers()), got);

    assert.equal(got.events[0]?.entity, 1);
    assert.equal(echoes.isEcho(got.events[0] ?? got.emit(CUES.id.mine)), true);
  });
});
