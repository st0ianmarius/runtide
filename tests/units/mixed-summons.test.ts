import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summon, type UnitDef } from '../../src/units/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** A caster and the two kinds of dead it raises. */
const TEMPLATES = {
  caster: {},
  skeleton: { stats: { maxHealth: 20 } },
  ghoul: { stats: { maxHealth: 40 } }
} satisfies Record<string, UnitDef<UnitGame>>;

/** The kinds a raise rotates through. */
const KINDS = ['skeleton', 'ghoul'] as const;

/** A game with one caster, of side 1. */
const raising = () => {
  const game = makeUnitGame(TEMPLATES, {});
  const caster = game.units.spawn(game.id.caster, { side: 1 });

  /** The template names of the caster's summons, in order. */
  const kinds = (): string[] =>
    game.units.summonsOf(caster).map((unit) => (unit.template === game.id.skeleton ? 'skeleton' : 'ghoul'));

  return { ...game, caster, kinds };
};

describe('mixed-template summons', () => {
  it('reads each summon’s template by its index, rotating through kinds; undefined keeps the proc’s unit', () => {
    const { procs, caster, kinds, id } = raising();
    const indexes: number[] = [];

    const outcome = procs.apply(
      summon<UnitGame>('skeleton', {
        count: 4,
        unitOf: (_ctx, index) => {
          indexes.push(index);

          return KINDS[index % KINDS.length];
        }
      }),
      { self: caster }
    );

    assert.deepEqual([outcome.status, outcome.amount], ['landed', 4]);
    assert.deepEqual(indexes, [0, 1, 2, 3]);
    assert.deepEqual(kinds(), ['skeleton', 'ghoul', 'skeleton', 'ghoul']);

    procs.apply(summon<UnitGame>('skeleton', { count: 2, unitOf: (_ctx, i) => (i === 0 ? id.ghoul : undefined) }), {
      self: caster
    });
    assert.deepEqual(kinds().slice(4), ['ghoul', 'skeleton']);
  });

  it('throws for a name unitOf reads that the registry does not have, and checks unitOf and of at prepare', () => {
    const { procs, caster } = raising();

    assert.throws(
      () => procs.apply(summon<UnitGame>('skeleton', { unitOf: () => 'lich' }), { self: caster }),
      /unknown unit template lich/
    );

    const notFunction = summon<UnitGame>('skeleton');
    const badScope = summon<UnitGame>('skeleton', { limit: { perOwner: 2 } });

    Reflect.set(notFunction, 'unitOf', 3);
    Reflect.set(badScope.limit ?? {}, 'of', 'all');
    assert.throws(() => procs.prepare([notFunction], 'Test'), /unitOf is a function/);
    assert.throws(() => procs.prepare([badScope], 'Test'), /counts 'template' or 'any'/);
  });

  it('caps every template together with of: any, refusing past it', () => {
    const { procs, caster, kinds } = raising();
    const limit = { perOwner: 3, replace: 'refuse', of: 'any' } as const;

    procs.apply(summon<UnitGame>('skeleton', { count: 2, limit }), { self: caster });

    const refill = procs.apply(summon<UnitGame>('ghoul', { count: 2, limit }), { self: caster });

    assert.deepEqual([refill.status, refill.amount], ['landed', 1]);
    assert.deepEqual(kinds(), ['skeleton', 'skeleton', 'ghoul']);
    assert.equal(procs.apply(summon<UnitGame>('skeleton', { limit }), { self: caster }).status, 'skipped');
  });

  it('replaces the owner’s oldest summon of any template with of: any', () => {
    const { procs, units, caster, kinds, log } = raising();
    const limit = { perOwner: 2, of: 'any' } as const;

    procs.apply(summon<UnitGame>('skeleton', { limit }), { self: caster });
    procs.apply(summon<UnitGame>('ghoul', { limit }), { self: caster });

    const [oldest] = units.summonsOf(caster);

    procs.apply(summon<UnitGame>('ghoul', { limit }), { self: caster });
    assert.deepEqual([oldest?.lifecycle, kinds()], ['despawned', ['ghoul', 'ghoul']]);
    assert.ok(log.includes('reason replaced'));
  });

  it('rejoins a revived summon only with room among every template under of: any', () => {
    const { procs, units, caster, kinds } = raising();
    const limit = { perOwner: 2, of: 'any' } as const;

    procs.apply(summon<UnitGame>('skeleton', { limit }), { self: caster });

    const [first] = units.summonsOf(caster);

    if (first !== undefined) {
      units.kill(first);
      procs.apply(summon<UnitGame>('ghoul', { count: 2, limit }), { self: caster });
      units.revive(first);
    }

    assert.deepEqual([first?.lifecycle, first?.owner, kinds()], ['alive', undefined, ['ghoul', 'ghoul']]);
  });

  it('keeps counting each template on its own by default', () => {
    const { procs, caster, kinds } = raising();

    for (const kind of KINDS) {
      procs.apply(summon<UnitGame>(kind, { count: 3, limit: { perOwner: 2, replace: 'refuse' } }), { self: caster });
    }

    assert.deepEqual(kinds(), ['skeleton', 'skeleton', 'ghoul', 'ghoul']);

    procs.apply(summon<UnitGame>('ghoul', { limit: { perOwner: 2, of: 'template' } }), { self: caster });
    assert.deepEqual(kinds(), ['skeleton', 'skeleton', 'ghoul', 'ghoul']);
  });
});
