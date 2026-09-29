import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { castSpell } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell } from '../helpers/spell-game.ts';

/** A game whose host answers ranks and variants from a map, with spells that log the rank and variant they got. */
const ranked = () => {
  const ranks = new Map<string, number>();
  const variants = new Map<string, number>();
  const label = (ctx: { readonly rank: number; readonly variant: number }) => mark(`r${ctx.rank} v${ctx.variant}`);

  const game = makeSpellGame(
    {
      glaive: spell({ activation: { kind: 'auto', interval: 1 }, release: (ctx) => [label(ctx)] }),
      nova: spell({ activation: { kind: 'trigger' }, release: (ctx) => [label(ctx)] }),
      chain: spell({ activation: { kind: 'trigger' }, release: () => [castSpell<Game>('nova')] }),
    },
    {
      host: {
        rankOf: (unit, spell) => ranks.get(`${unit.id}:${spell}`),
        variantOf: (unit, spell) => variants.get(`${unit.id}:${spell}`),
      },
    },
  );

  const hero = game.unit(1);
  const key = (name: keyof typeof game.id) => `1:${game.id[name]}`;
  const lines = () => game.log.filter((line) => /^r\d/.test(line));

  return { ...game, hero, ranks, variants, key, lines };
};

describe('the caster’s own rank and variant (§I.7.1 F20)', () => {
  it('reach a cast that names none, while a cast’s own options win, and default to rank 1, variant 0', () => {
    const { spells, id, hero, ranks, variants, key, lines } = ranked();

    spells.cast(hero, id.nova);
    ranks.set(key('nova'), 3);
    variants.set(key('nova'), 1);
    spells.cast(hero, id.nova);
    spells.cast(hero, id.nova, { rank: 2, variant: 0 });
    assert.deepEqual(lines(), ['r1 v0@1', 'r3 v1@1', 'r2 v0@1']);
  });

  it('reach an auto clock’s casts: a card’s rank', () => {
    const { spells, hero, ranks, key, lines } = ranked();

    ranks.set(key('glaive'), 4);
    spells.stepAuto(hero);
    assert.deepEqual(lines(), ['r4 v0@1']);
  });

  it('reach a castSpell outside a cast, while a chained one keeps its parent’s rank and a proc’s own rank wins', () => {
    const { spells, procs, id, hero, ranks, key, lines } = ranked();

    ranks.set(key('nova'), 5);
    procs.apply(castSpell<Game>('nova'), { self: hero });
    spells.cast(hero, id.chain, { rank: 2 });
    procs.apply(castSpell<Game>('nova', { rank: 3 }), { self: hero });
    assert.deepEqual(lines(), ['r5 v0@1', 'r2 v0@1', 'r3 v0@1']);
  });
});
