import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraView, ViewOptions } from '../../src/auras/index.ts';
import { explainAura, NO_SOURCE } from '../../src/auras/index.ts';
import { POOL_MIN_FREE } from '../../src/core/index.ts';
import { aura, makeGame, TAGS } from '../helpers/aura-game.ts';

/** A bearer's aura views, in a fresh array. */
const viewsOf = <Bearer>(
  system: { readonly view: (bearer: Bearer, out: AuraView[], options?: ViewOptions) => number },
  bearer: Bearer,
  options?: ViewOptions
): AuraView[] => {
  const out: AuraView[] = [];

  return out.slice(0, system.view(bearer, out, options));
};

const defs = {
  shell: aura({
    duration: 10,
    value: 40,
    stacking: 'highest',
    merge: 'max',
    keepWhenDepleted: true,
    tags: ['boon']
  }),
  cooldown: aura({ audience: 'owner', clock: 'motion' }),
  echo: aura({ duration: 3, stacking: 'independent', maxStacks: 2 }),

  bleed: aura({
    duration: 'infinite',
    stacking: (): undefined => undefined,
    maxStacks: 9,
    merge: (current, incoming) => current + incoming / 2,
    perSource: true,
    tags: ['poison'],
    blockedBy: ['immune'],
    removes: ['boon', 'magic'],
    clock: 'motion',
    periodic: { every: 1.5, onBeat: () => undefined }
  }),

  live: aura({ duration: () => 1, periodic: { every: () => 2, onBeat: () => undefined } })
};

describe('views for the wire', () => {
  it('show each viewer what it may see: the owner everything, the party all but owner auras, others all auras', () => {
    const { auras, id, unit } = makeGame({
      ...defs,
      frame: aura({ duration: 5, audience: 'party' })
    });

    const u = unit();

    const seen = (viewer: 'owner' | 'party' | 'other') => viewsOf(auras, u, { for: viewer }).map((view) => view.aura);

    auras.apply(u, id.shell);
    auras.apply(u, { aura: id.cooldown, duration: 2 });
    auras.apply(u, id.frame);
    assert.deepEqual(seen('owner'), [id.shell, id.cooldown, id.frame]);
    assert.deepEqual(seen('party'), [id.shell, id.frame]);
    assert.deepEqual(seen('other'), [id.shell]);
  });

  it('fill the caller’s records from index 0, reused from call to call', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();
    const out: AuraView[] = [];

    auras.apply(u, id.shell);
    auras.apply(u, id.echo);
    assert.equal(auras.view(u, out), 2);

    const [first] = out;

    auras.remove(u, id.echo);
    assert.equal(auras.view(u, out), 1);
    assert.equal(out[0], first);
    assert.equal(out.length, 2);
  });

  it('carry ids and numbers only, in list order, and leave owner-only auras to the owner', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.shell, source: 7 });
    auras.apply(u, { aura: id.cooldown, duration: 2 });
    run(u, 4);
    assert.deepEqual(viewsOf(auras, u), [
      {
        aura: id.shell,
        serial: 0,
        stacks: 1,
        value: 40,
        duration: 10,
        end: 80,
        clock: 0,
        source: 7
      }
    ]);
    assert.deepEqual(viewsOf(auras, u, { for: 'owner' })[1], {
      aura: id.cooldown,
      serial: 0,
      stacks: 1,
      value: 0,
      duration: 2,
      end: 16,
      clock: 1,
      source: NO_SOURCE
    });
  });
});

describe('explainAura', () => {
  it('explains an aura as data, with its rules, tags and beat', () => {
    const { auras, id } = makeGame(defs);

    assert.deepEqual(explainAura(auras, id.bleed, 2), {
      kind: 'aura',
      aura: id.bleed,
      stacks: 2,
      duration: 'infinite',
      clock: 1,
      stacking: 'custom',
      maxStacks: 9,
      isPerSource: true,
      merge: 'custom',
      value: 0,
      keepsWhenDepleted: false,
      audience: 'all',
      tags: [TAGS.id.poison],
      blockedBy: [TAGS.id.immune],
      removes: [TAGS.id.boon, TAGS.id.magic],
      modifiers: [],
      periodic: { every: 1.5, clock: 1 }
    });
  });

  it('says which numbers are read live and which the application gives', () => {
    const { auras, id } = makeGame(defs);

    assert.deepEqual(
      [explainAura(auras, id.live).duration, explainAura(auras, id.live).periodic?.every],
      ['live', 'live']
    );
    assert.equal(explainAura(auras, id.cooldown).duration, 'given');
    assert.deepEqual([explainAura(auras, id.shell).stacking, explainAura(auras, id.shell).merge], ['highest', 'max']);
  });
});

describe('the aura pool', () => {
  it('reuses slots, so a steady state of applications and expiries makes none', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    const cycle = (): void => {
      auras.apply(u, id.echo);
      auras.apply(u, id.echo);
      run(u, 24);
    };

    // Past the pool's minimum of waiting free slots, it reuses them.
    for (let i = 0; i <= POOL_MIN_FREE; i++) {
      cycle();
    }

    const { created } = auras.pool;

    for (let i = 0; i < 3; i++) {
      cycle();
    }

    assert.equal(auras.pool.created, created);
    assert.ok(created <= POOL_MIN_FREE + 2);
    assert.equal(auras.pool.live, 0);
  });

  it('turns a kept handle stale once its aura has left, and gives the slot back clean', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.shell, source: 3 });

    const kept = auras.find(u, id.shell);
    const handle = kept?.handle;

    auras.remove(u, id.shell);
    assert.equal(kept?.isActive, false);
    auras.apply(u, id.echo);
    assert.notEqual(auras.find(u, id.echo)?.handle, handle);
    assert.equal(auras.find(u, id.echo)?.source, NO_SOURCE);
  });
});
