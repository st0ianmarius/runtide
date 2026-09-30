import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { castSpell } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell } from '../helpers/spell-game.ts';

/** A game whose host answers ranks from a map, with spells that log the rank they got. */
const ranked = () => {
  const ranks = new Map<string, number>();
  const label = (ctx: { readonly rank: number }) => mark(`r${ctx.rank}`);

  const game = makeSpellGame(
    {
      glaive: spell({ activation: { kind: 'auto', interval: 1 }, release: (ctx) => [label(ctx)] }),
      nova: spell({ activation: { kind: 'trigger' }, release: (ctx) => [label(ctx)] }),
      chain: spell({ activation: { kind: 'trigger' }, release: () => [castSpell<Game>('nova')] })
    },
    {
      host: {
        rankOf: (unit, spell) => ranks.get(`${unit.id}:${spell}`)
      }
    }
  );

  const hero = game.unit(1);
  const key = (name: keyof typeof game.id) => `1:${game.id[name]}`;
  const lines = () => game.log.filter((line) => /^r\d/.test(line));

  return { ...game, hero, ranks, key, lines };
};

describe('the caster’s own rank', () => {
  it('reach a cast that names none, while a cast’s own options win, and default to rank 1', () => {
    const { spells, id, hero, ranks, key, lines } = ranked();

    spells.cast(hero, id.nova);
    ranks.set(key('nova'), 3);
    spells.cast(hero, id.nova);
    spells.cast(hero, id.nova, { rank: 2 });
    assert.deepEqual(lines(), ['r1@1', 'r3@1', 'r2@1']);
  });

  it('reach an auto clock’s casts: a card’s rank', () => {
    const { spells, hero, ranks, key, lines } = ranked();

    ranks.set(key('glaive'), 4);
    spells.stepAuto(hero);
    assert.deepEqual(lines(), ['r4@1']);
  });

  it('reach a castSpell outside a cast, while a chained one keeps its parent’s rank and a proc’s own rank wins', () => {
    const { spells, procs, id, hero, ranks, key, lines } = ranked();

    ranks.set(key('nova'), 5);
    procs.apply(castSpell<Game>('nova'), { self: hero });
    spells.cast(hero, id.chain, { rank: 2 });
    procs.apply(castSpell<Game>('nova', { rank: 3 }), { self: hero });
    assert.deepEqual(lines(), ['r5@1', 'r2@1', 'r3@1']);
  });
});
