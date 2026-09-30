import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { createBitset } from '../../src/core/index.ts';
import { aura, makeGame } from '../helpers/aura-game.ts';

const defs = {
  renew: aura({ duration: 2, tags: ['boon'] }),
  rend: aura({ duration: 3, stacking: 'stack', maxStacks: 4, tags: ['poison'] }),
  echo: aura({ duration: 1, stacking: 'independent', maxStacks: 3, tags: ['magic'] }),
  shell: aura({ duration: 4, stacking: 'highest', merge: 'max', keepWhenDepleted: true }),
  well: aura({ duration: 5, stacking: () => undefined, merge: 'add' }),
  mark: aura({ duration: 2, perSource: true, merge: 'replace', tags: ['stun'] }),
  purge: aura({ duration: 1, removes: ['poison', 'magic'] }),
};

type Name = keyof typeof defs;

/** One random operation on a bearer. */
type Step =
  | {
      readonly kind: 'apply';
      readonly name: Name;
      readonly stacks: number;
      readonly value: number;
      readonly source: number;
    }
  | { readonly kind: 'tick'; readonly count: number }
  | { readonly kind: 'remove'; readonly name: Name }
  | { readonly kind: 'spend'; readonly name: Name; readonly amount: number };

const names = fc.constantFrom<Name>('renew', 'rend', 'echo', 'shell', 'well', 'mark', 'purge');

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('apply' as const),
    name: names,
    stacks: fc.integer({ min: -2, max: 9 }),
    value: fc.integer({ min: 0, max: 50 }),
    source: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({ kind: fc.constant('tick' as const), count: fc.integer({ min: 1, max: 12 }) }),
  fc.record({ kind: fc.constant('remove' as const), name: names }),
  fc.record({ kind: fc.constant('spend' as const), name: names, amount: fc.integer({ min: 0, max: 60 }) }),
);

describe('stacking and merge invariants (fast-check)', () => {
  it('keep the list sorted, the stacks and instances within their caps, and the tags the union of the list', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const { auras, id, unit, run, registry } = makeGame(defs);
        const u = unit();

        for (const s of steps) {
          if (s.kind === 'apply') {
            auras.apply(u, { aura: id[s.name], stacks: s.stacks, value: s.value, source: s.source });
          } else if (s.kind === 'tick') {
            run(u, s.count);
          } else if (s.kind === 'remove') {
            auras.remove(u, id[s.name]);
          } else {
            auras.spendValue(u, id[s.name], s.amount);
          }

          const list = u.auras.list;
          const tags = createBitset();

          for (const [index, active] of list.entries()) {
            const previous = list[index - 1];
            const maxStacks = registry.get(active.id).maxStacks ?? 1;

            assert.ok(previous === undefined || previous.id < active.id || previous.serial < active.serial);
            assert.ok(active.stacks >= 1 && active.stacks <= maxStacks);
            assert.ok(active.isActive);

            for (const tag of registry.get(active.id).tags ?? []) {
              tags.add(auras.tags.id[tag]);
            }
          }

          assert.ok(list.filter((a) => a.id === id.echo).length <= 3);
          assert.ok(list.filter((a) => a.id === id.renew).length <= 1);
          assert.ok(u.auras.tags.equals(tags));
          assert.equal(auras.pool.live, list.length);
        }
      }),
    );
  });

  it('merge values as declared: max keeps the largest, add sums, replace takes the last', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 12 }), (values) => {
        const { auras, id, unit } = makeGame(defs);
        const u = unit();

        for (const value of values) {
          auras.apply(u, { aura: id.shell, value });
          auras.apply(u, { aura: id.well, value });
          auras.apply(u, { aura: id.mark, value, source: 1 });
        }

        assert.equal(auras.find(u, id.shell)?.value, Math.max(...values));
        assert.equal(
          auras.find(u, id.well)?.value,
          values.reduce((sum, value) => sum + value, 0),
        );
        assert.equal(auras.find(u, id.mark)?.value, values.at(-1));
      }),
    );
  });

  it('spend value exactly: what is spent plus what is left is what there was', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), fc.array(fc.integer({ min: 0, max: 200 })), (start, spends) => {
        const { auras, id, unit } = makeGame(defs);
        const u = unit();
        let spent = 0;

        auras.apply(u, { aura: id.shell, value: start });

        for (const amount of spends) {
          spent += auras.spendValue(u, id.shell, amount);
        }

        assert.equal(spent + (auras.find(u, id.shell)?.value ?? 0), start);
        assert.equal(auras.has(u, id.shell), true, 'an absorb that keeps its clock stays at 0');
      }),
    );
  });
});
