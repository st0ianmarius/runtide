import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AuraView, createAuraEvent } from '../../src/auras/index.ts';
import { createBus } from '../../src/core/index.ts';
import { aura, makeGame, TAGS, type TestAuras, type Unit } from '../helpers/aura-game.ts';

/** Hooks that log an aura's refreshes and expiries as `change:name`. */
const logged = (name: string) =>
  ({
    onRefreshed: () => [`refreshed:${name}`],
    onExpired: () => [`expired:${name}`]
  }) as const;

/** A game of cooldowns granting `magic` (two finite, one infinite, one on the motion clock) and a poison. */
const game = () => {
  const bus = createBus({ aura: createAuraEvent<TestAuras> });
  const heard: string[] = [];

  const g = makeGame(
    {
      long: aura({ duration: 4, tags: ['magic'], ...logged('long') }),
      short: aura({ duration: 2, tags: ['magic'], ...logged('short') }),
      aegis: aura({ duration: 'infinite', tags: ['magic'], ...logged('aegis') }),
      spin: aura({ duration: 2, tags: ['magic'], clock: 'motion', ...logged('spin') }),
      venom: aura({ duration: 4, tags: ['poison'], ...logged('venom') })
    },
    { events: { bus, changed: bus.kind.aura } }
  );

  bus.on(bus.kind.aura, (event) => heard.push(event.change ?? '?'));

  return { ...g, heard };
};

/** A bearer's views, each copied, keyed by aura id. */
const viewsOf = (g: ReturnType<typeof game>, u: Unit): Map<number, AuraView> => {
  const out: AuraView[] = [];
  const count = g.auras.view(u, out, { for: 'owner' });

  return new Map(out.slice(0, count).map((view) => [view.aura, { ...view }]));
};

describe('scaleTimeLeft', () => {
  it('scales the time left of every finite aura granting the tag, keeping its duration, and counts them', () => {
    const g = game();
    const u = g.unit();

    for (const id of [g.id.long, g.id.short, g.id.aegis, g.id.venom]) {
      g.auras.apply(u, id);
    }

    g.run(u, 8);

    const before = viewsOf(g, u);

    assert.equal(g.auras.scaleTimeLeft(u, TAGS.id.magic, 0.5), 2);

    const after = viewsOf(g, u);

    assert.deepEqual(
      [g.auras.remaining(u, g.id.long), g.auras.remaining(u, g.id.short), g.auras.remaining(u, g.id.venom)],
      [1.5, 0.5, 3]
    );
    assert.deepEqual(
      [after.get(g.id.long)?.duration, after.get(g.id.short)?.duration],
      [before.get(g.id.long)?.duration, before.get(g.id.short)?.duration]
    );
    assert.deepEqual(after.get(g.id.aegis), before.get(g.id.aegis));
    assert.deepEqual(after.get(g.id.venom), before.get(g.id.venom));
  });

  it('raises nothing, no hook and no bus event, and counts as a change of the bearer’s list', () => {
    const g = game();
    const u = g.unit();

    g.auras.apply(u, g.id.long);
    g.heard.length = 0;

    const changes = u.auras.changes;

    assert.equal(g.auras.scaleTimeLeft(u, TAGS.id.magic, 0.5), 1);
    assert.deepEqual([g.log, g.heard, u.auras.changes], [[], [], changes + 1]);
  });

  it('changes nothing and counts no change when no time left moves', () => {
    const g = game();
    const u = g.unit();

    g.auras.apply(u, g.id.aegis);
    g.auras.apply(u, g.id.venom);

    const changes = u.auras.changes;

    assert.equal(g.auras.scaleTimeLeft(u, TAGS.id.magic, 0.5), 0);
    assert.equal(g.auras.scaleTimeLeft(u, TAGS.id.poison, 1), 0);
    assert.equal(u.auras.changes, changes);
  });

  it('runs an aura scaled to 0 out on the next tick of its own clock', () => {
    const g = game();
    const u = g.unit();

    g.auras.apply(u, g.id.long);
    g.auras.apply(u, g.id.spin);
    assert.equal(g.auras.scaleTimeLeft(u, TAGS.id.magic, 0), 2);
    g.run(u, 1, 'motion');
    assert.deepEqual([g.auras.has(u, g.id.long), g.auras.has(u, g.id.spin)], [true, false]);
    g.run(u, 1, 'world');
    assert.equal(g.auras.has(u, g.id.long), false);
    assert.deepEqual(g.log, ['expired:spin@1', 'expired:long@1']);
  });

  it('throws on a NaN, negative or infinite factor', () => {
    const g = game();
    const u = g.unit();

    for (const factor of [Number.NaN, -1, Infinity]) {
      assert.throws(() => g.auras.scaleTimeLeft(u, TAGS.id.magic, factor), /a finite factor and a cap from 0/);
    }
  });
});

describe('clampTimeLeft', () => {
  it('caps the time left of every finite aura granting the tag, and returns 0 when none was above the cap', () => {
    const g = game();
    const u = g.unit();

    g.auras.apply(u, g.id.long);
    g.auras.apply(u, g.id.short);
    g.auras.apply(u, g.id.aegis);

    const changes = u.auras.changes;

    assert.equal(g.auras.clampTimeLeft(u, TAGS.id.magic, 3), 1);
    assert.deepEqual([g.auras.remaining(u, g.id.long), g.auras.remaining(u, g.id.short)], [3, 2]);
    assert.equal(viewsOf(g, u).get(g.id.long)?.duration, 4);
    assert.equal(g.auras.clampTimeLeft(u, TAGS.id.magic, 3), 0);
    assert.deepEqual([g.log, u.auras.changes], [[], changes + 1]);
  });

  it('runs an aura clamped to 0 out on the next tick of its own clock', () => {
    const g = game();
    const u = g.unit();

    g.auras.apply(u, g.id.long);
    g.auras.apply(u, g.id.spin);
    assert.equal(g.auras.clampTimeLeft(u, TAGS.id.magic, 0), 2);
    g.run(u, 1, 'world');
    assert.deepEqual([g.auras.has(u, g.id.long), g.auras.has(u, g.id.spin)], [false, true]);
    g.run(u, 1, 'motion');
    assert.equal(g.auras.has(u, g.id.spin), false);
    assert.deepEqual(g.log, ['expired:long@1', 'expired:spin@1']);
  });

  it('throws on a negative cap', () => {
    const g = game();

    assert.throws(() => g.auras.clampTimeLeft(g.unit(), TAGS.id.magic, -1), /a finite factor and a cap from 0/);
  });
});
