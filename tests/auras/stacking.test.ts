import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aura, makeGame } from '../helpers/aura-game.ts';

const defs = {
  renew: aura({ duration: 4, stacking: 'refresh', tags: ['boon'] }),
  prolong: aura({ duration: 2, stacking: 'extend' }),
  rend: aura({ duration: 5, stacking: 'stack', maxStacks: 3 }),
  chill: aura({ duration: 2, stacking: 'highest' }),
  ward: aura({ duration: 10, stacking: () => undefined, value: 20, merge: 'add' }),
  echo: aura({ duration: 3, stacking: 'independent', maxStacks: 2 }),
  mark: aura({ duration: 6, perSource: true }),
  first: aura({ duration: 6, credit: 'first' }),

  halving: aura({
    duration: 8,
    maxStacks: 4,

    stacking: (ctx, incoming) =>
      incoming.seconds > incoming.remaining ? { seconds: incoming.seconds, stacks: ctx.aura.stacks + 1 } : undefined
  })
};

describe('stacking rules (a re-application on the instance already there)', () => {
  it('refresh restarts the clock at the new length, shorter or longer, and keeps one instance', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    assert.deepEqual(auras.apply(u, id.renew), { applied: true, fresh: true, changed: true });
    run(u, 8);
    assert.equal(auras.remaining(u, id.renew), 3);
    assert.deepEqual(auras.apply(u, { aura: id.renew, duration: 1 }), {
      applied: true,
      fresh: false,
      changed: true
    });
    assert.equal(auras.remaining(u, id.renew), 1);
    assert.equal(u.auras.list.length, 1);
  });

  it('extend adds the new length to what is left, and the duration becomes the new time left', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.prolong);
    run(u, 4);
    auras.apply(u, id.prolong);
    assert.equal(auras.remaining(u, id.prolong), 3.5);
    assert.equal(auras.find(u, id.prolong)?.duration, 3.5);
  });

  it('stack adds stacks up to maxStacks and restarts the clock at every application', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.rend);
    auras.apply(u, { aura: id.rend, stacks: 1.9 });
    assert.equal(auras.stacks(u, id.rend), 2, 'stacks are max(1, floor(n))');
    auras.apply(u, { aura: id.rend, stacks: 5 });
    assert.equal(auras.stacks(u, id.rend), 3, 'capped at maxStacks');
    run(u, 16);
    assert.deepEqual(auras.apply(u, id.rend), { applied: true, fresh: false, changed: true });
    assert.equal(auras.remaining(u, id.rend), 5, 'at the cap the clock still restarts');
    assert.equal(auras.stacks(u, id.rend), 3);
  });

  it('a fresh instance starts at the application stacks within the cap', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.rend, stacks: 7 });
    assert.equal(auras.stacks(u, id.rend), 3);
    auras.apply(u, { aura: id.renew, stacks: 7 });
    assert.equal(auras.stacks(u, id.renew), 1, 'a one-stack aura starts at 1');
  });

  it('highest keeps the later end; a shorter application changes nothing and counts as no change', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.chill);
    run(u, 4);

    const changes = u.auras.changes;

    assert.deepEqual(auras.apply(u, { aura: id.chill, duration: 1 }), {
      applied: true,
      fresh: false,
      changed: false
    });
    assert.equal(u.auras.changes, changes);
    assert.equal(auras.remaining(u, id.chill), 1.5);
    assert.deepEqual(auras.apply(u, { aura: id.chill, duration: 1.5 }).changed, false, 'the same end changes nothing');
    assert.equal(auras.apply(u, id.chill).changed, true);
    assert.equal(auras.remaining(u, id.chill), 2);
  });

  it('a rule answering nothing leaves the clock alone and only merges the value (a top-up)', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.ward);
    run(u, 8);
    assert.deepEqual(auras.apply(u, { aura: id.ward, value: 5 }), {
      applied: true,
      fresh: false,
      changed: true
    });
    assert.equal(auras.remaining(u, id.ward), 9);
    assert.equal(auras.find(u, id.ward)?.value, 25);
  });

  it('independent runs one instance per application; at the cap the one with least time left makes way', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.echo, source: 1 });
    run(u, 8);
    auras.apply(u, { aura: id.echo, source: 2 });
    assert.equal(auras.stacks(u, id.echo), 2);
    auras.apply(u, { aura: id.echo, source: 3 });
    assert.deepEqual(
      u.auras.list.map((a) => a.source),
      [2, 3]
    );
    assert.deepEqual(
      u.auras.list.map((a) => a.serial),
      [2, 3]
    );
    assert.equal(auras.remaining(u, id.echo), 3, 'the longest instance');
    run(u, 24);
    assert.equal(u.auras.list.length, 0);
  });

  it('independent evicts the first of equals at the cap', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.echo, source: 1 });
    auras.apply(u, { aura: id.echo, source: 2 });
    auras.apply(u, { aura: id.echo, source: 3 });
    assert.deepEqual(
      u.auras.list.map((a) => a.source),
      [2, 3]
    );
  });

  it('a per-source aura keeps one instance per source (WoW per-caster auras)', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.mark, source: 7 });
    run(u, 8);
    auras.apply(u, { aura: id.mark, source: 9 });
    assert.equal(u.auras.list.length, 2);
    assert.deepEqual(auras.apply(u, { aura: id.mark, source: 7 }).fresh, false);
    assert.deepEqual(
      u.auras.list.map((a) => [a.source, auras.remainingOf(u, a)]),
      [
        [7, 6],
        [9, 6]
      ]
    );
  });

  it('credit goes to the newest explicit source unless the aura keeps the first', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.renew, source: 4 });
    auras.apply(u, { aura: id.renew, source: 5 });
    auras.apply(u, id.renew);
    assert.equal(auras.find(u, id.renew)?.source, 5, 'no source given leaves it');
    auras.apply(u, { aura: id.first, source: 4 });
    auras.apply(u, { aura: id.first, source: 5 });
    assert.equal(auras.find(u, id.first)?.source, 4);
  });

  it("a game's own rule decides the clock and the stacks, or nothing", () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.halving);
    run(u, 8);
    assert.deepEqual(auras.apply(u, { aura: id.halving, duration: 2 }), {
      applied: true,
      fresh: false,
      changed: false
    });
    assert.equal(auras.apply(u, id.halving).changed, true);
    assert.equal(auras.stacks(u, id.halving), 2);
    assert.equal(auras.remaining(u, id.halving), 8);
  });

  it('an application may pick its own built-in rule', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.renew);
    run(u, 8);
    assert.equal(auras.apply(u, { aura: id.renew, duration: 1, stacking: 'highest' }).changed, false);
    assert.equal(auras.remaining(u, id.renew), 3);
    auras.apply(u, { aura: id.rend, stacks: 2 });
    auras.apply(u, { aura: id.rend, stacking: 'refresh' });
    assert.equal(auras.stacks(u, id.rend), 2, 'a refresh leaves the stacks');
  });

  it('keeps the list in registry order, then application order, whatever the order of application', () => {
    const orders = [
      ['mark', 'renew', 'echo', 'chill', 'echo'],
      ['echo', 'chill', 'mark', 'echo', 'renew']
    ] as const;

    const lists = orders.map((order) => {
      const { auras, id, unit } = makeGame(defs);
      const u = unit();

      for (const name of order) {
        auras.apply(u, id[name]);
      }

      return u.auras.list.map((a) => [a.id, a.serial]);
    });

    assert.deepEqual(lists[0], [
      [0, 0],
      [3, 0],
      [5, 2],
      [5, 3],
      [6, 1]
    ]);
    assert.deepEqual(
      lists[1]?.map(([auraId]) => auraId),
      [0, 3, 5, 5, 6]
    );
  });
});
