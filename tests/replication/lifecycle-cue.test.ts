import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkAuraCues, defineAuras } from '../../src/auras/index.ts';
import { TOMBSTONE } from '../../src/core/index.ts';
import { defineCue, defineCues } from '../../src/cues/index.ts';
import { type AuraLifecycle, lifecycleCue } from '../../src/replication/index.ts';
import { aura } from '../helpers/aura-game.ts';

/** Cues on the bearer, one for each case. */
const CUES = defineCues({
  glow: defineCue({ anchor: 'self' }),
  pulse: defineCue({ anchor: 'self' }),
  stack: defineCue({ anchor: 'self' }),
  fade: defineCue({ anchor: 'entity' }),
  pop: defineCue({ anchor: 'entity' }),
  fall: defineCue({ anchor: 'self' }),
  far: defineCue({ anchor: 'world' })
});

const AURAS = defineAuras({
  ward: aura({
    cues: {
      applied: CUES.id.glow,
      refreshed: CUES.id.pulse,
      stacked: CUES.id.stack,
      expired: CUES.id.fade,
      removed: CUES.id.pop,
      stateEntered: CUES.id.fall
    }
  }),
  plain: aura({ cues: { refreshed: CUES.id.pulse } }),
  bare: aura({}),
  old: TOMBSTONE
});

const CHANGES: readonly AuraLifecycle[] = ['applied', 'refreshed', 'stacked', 'changed', 'expired', 'removed'];

describe('a derived lifecycle change’s cue', () => {
  it('is the aura’s own cue, its refreshed cue for a stacked or changed it declares none for, or none', () => {
    const cuesOf = (id: (typeof AURAS.id)[keyof typeof AURAS.id]) =>
      CHANGES.map((change) => lifecycleCue(AURAS, id, change));

    assert.deepEqual(cuesOf(AURAS.id.ward), [
      CUES.id.glow,
      CUES.id.pulse,
      CUES.id.stack,
      CUES.id.pulse,
      CUES.id.fade,
      CUES.id.pop
    ]);
    assert.deepEqual(cuesOf(AURAS.id.plain), [
      undefined,
      CUES.id.pulse,
      CUES.id.pulse,
      CUES.id.pulse,
      undefined,
      undefined
    ]);
    assert.deepEqual(cuesOf(AURAS.id.bare), [undefined, undefined, undefined, undefined, undefined, undefined]);
    assert.deepEqual(cuesOf(AURAS.id.old), [undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('checks stacked, changed and the local-only stateEntered cues at load like the others', () => {
    assert.doesNotThrow(() => {
      checkAuraCues(AURAS, CUES);
    });
    assert.throws(() => {
      checkAuraCues(defineAuras({ ward: aura({ cues: { changed: CUES.id.far } }) }), CUES);
    }, /Aura ward's changed cue: far must sit on the bearer/);
  });
});
