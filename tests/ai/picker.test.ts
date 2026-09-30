import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setFocus } from '../../src/ai/index.ts';
import type { AnySpellDef, SpellId } from '../../src/spells/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** A spell a brain picks, with no timeline. */
const aiSpell = (canCast?: () => boolean): AnySpellDef<UnitGame> => ({
  activation: { kind: 'trigger' },
  ...(canCast === undefined ? {} : { canCast }),
  release: () => undefined,
});

/** A draw that always answers `value`. */
const fixed = (value: number) => () => value;

/** A game with a pool of three spells: slam (weight 1), bolt (3), and nova (4), which the gates refuse when closed. */
const picking = () => {
  const gate = { isOpen: true };

  const game = makeUnitGame(
    { beast: {} },
    { spells: { slam: aiSpell(), bolt: aiSpell(), nova: aiSpell(() => gate.isOpen) } },
  );

  const beast = game.units.spawn(game.id.beast, { side: 1 });
  const { slam, bolt, nova } = game.spellId;
  const pool: readonly SpellId[] = [slam, bolt, nova];

  const weights = new Map([
    [slam, 1],
    [bolt, 3],
    [nova, 4],
  ]);

  const weight = (_unit: unknown, spell: SpellId): number => weights.get(spell) ?? 0;

  return { ...game, beast, pool, gate, weight, slam, bolt, nova };
};

describe('the weighted anti-repeat picker', () => {
  it('draws in proportion to the game’s weights, over the spells that would start', () => {
    const { ai, beast, pool, gate, weight, slam, bolt, nova } = picking();

    assert.equal(ai.pick(beast, pool, { random: fixed(0), weight, repeat: 'allow' }), slam);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.2), weight, repeat: 'allow' }), bolt);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.6), weight, repeat: 'allow' }), nova);
    gate.isOpen = false;
    assert.equal(ai.pick(beast, pool, { random: fixed(0.99), weight, repeat: 'allow' }), bolt);
    assert.equal(beast.brain.lastPick, bolt);
  });

  it('leaves the last pick out while another fits, and picks it when it is the only one', () => {
    const { ai, beast, pool, weight, bolt, slam } = picking();

    ai.pick(beast, pool, { random: fixed(0.2), weight });
    assert.equal(
      ai.pick(beast, pool, { random: fixed(0), weight: (_unit, spell) => (spell === slam ? 0 : 1) }),
      pool[2],
    );
    assert.equal(ai.pick(beast, [bolt], { random: fixed(0.5) }), bolt);
    assert.equal(ai.pick(beast, [bolt], { random: fixed(0.5) }), bolt);
  });

  it('takes the game’s filter (a budget), weighs 1 by default, and answers none when nothing fits', () => {
    const { ai, beast, pool, slam, bolt } = picking();
    const allows = (_unit: unknown, spell: SpellId) => spell !== bolt;

    assert.equal(ai.pick(beast, pool, { random: fixed(0.3), allows, repeat: 'allow' }), slam);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.3), weight: () => 0 }), undefined);
    assert.equal(ai.pick(beast, [], { random: fixed(0.3) }), undefined);
  });

  it('finds the first spell of an ordered list that would start (a reaction)', () => {
    const { ai, beast, gate, slam, nova } = picking();

    assert.equal(ai.first(beast, [nova, slam]), nova);
    gate.isOpen = false;
    assert.equal(ai.first(beast, [nova, slam]), slam);
    assert.equal(ai.first(beast, [nova, slam], { allows: () => false }), undefined);
    assert.equal(beast.brain.lastPick, -1);
  });
});

describe('the focus', () => {
  it('is set by the game or by the setFocus proc, and cleared', () => {
    const { ai, procs, units, id, beast } = picking();
    const hero = units.spawn(id.beast, { side: 0 });

    assert.equal(ai.focusOf(beast), -1);
    procs.apply(setFocus<UnitGame>(), { self: beast, target: hero });
    assert.equal(ai.focusOf(beast), hero.id);
    procs.apply(setFocus<UnitGame>({ focus: 'none' }), { self: beast });
    assert.equal(ai.focusOf(beast), -1);
    ai.setFocus(beast, 7);
    assert.equal(beast.brain.focus, 7);
  });
});
