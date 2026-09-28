import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auraCue, checkAuraCues, defineAuras } from '../../src/auras/index.ts';
import { TOMBSTONE } from '../../src/core/index.ts';
import { createCueBuffer, type CueId, defineCue, defineCues, fireCue } from '../../src/cues/index.ts';
import { aura, makeGame } from '../helpers/trigger-game.ts';

/** A neutral cue table: two cues on the bearer, one at a point, one nobody's, and a retired slot. */
const CUES = defineCues({
  glow: defineCue({ anchor: 'self' }),
  fade: defineCue({ anchor: 'entity' }),
  burst: defineCue({ anchor: 'target' }),
  gong: defineCue({ anchor: 'world' }),
  gone: TOMBSTONE,
});

describe('aura lifecycle cues (§II.3.9, §II.6 A7)', () => {
  it('reads the cue an aura declares for a change, and none for the others', () => {
    const auras = defineAuras({
      ward: aura({ duration: 2, cues: { applied: CUES.id.glow, expired: CUES.id.fade } }),
      old: TOMBSTONE,
    });

    assert.equal(auraCue(auras, auras.id.ward, 'applied'), CUES.id.glow);
    assert.equal(auraCue(auras, auras.id.ward, 'expired'), CUES.id.fade);
    assert.equal(auraCue(auras, auras.id.ward, 'removed'), undefined);
    assert.equal(auraCue(auras, auras.id.old, 'applied'), undefined);
  });

  it('checks every declared cue at load: live, and sitting on the bearer', () => {
    const on = (cue: CueId) => () => {
      checkAuraCues(
        defineAuras({ ok: aura({ cues: { applied: CUES.id.glow } }), ward: aura({ cues: { removed: cue } }) }),
        CUES,
      );
    };

    assert.doesNotThrow(on(CUES.id.glow));
    assert.doesNotThrow(on(CUES.id.fade));
    assert.throws(on(CUES.id.burst), /Aura ward's removed cue: burst must sit on the bearer/);
    assert.throws(on(CUES.id.gong), /Aura ward's removed cue: gong must sit on the bearer/);
    assert.throws(on(CUES.id.gone), /Aura ward's removed cue: 4 is not a live cue id/);
  });

  it('lets a local game play them from the aura events, in the order the changes happened', () => {
    const out = createCueBuffer(CUES);
    const game = makeGame({ ward: aura({ duration: 2, cues: { applied: CUES.id.glow, removed: CUES.id.fade } }) });
    const unit = game.unit(4);

    game.bus.on(game.bus.kind.aura, (event) => {
      const cue = event.aura === undefined ? undefined : auraCue(game.registry, event.aura.id, event.change);
      const id = event.bearer?.id ?? -1;

      if (cue !== undefined) {
        fireCue(out, { cue }, { owner: id, entity: id, x: id, z: 0 });
      }
    });

    game.auras.apply(unit, game.id.ward);
    game.auras.apply(unit, game.id.ward);
    game.auras.remove(unit, game.id.ward);

    assert.deepEqual(
      out.events.slice(0, out.count).map((event) => [CUES.name(event.cue), event.owner, event.entity]),
      [
        ['glow', 4, 4],
        ['fade', 4, 4],
      ],
    );
  });
});
