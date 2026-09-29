import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setFocus } from '../../src/ai/index.ts';
import type { AnySpellDef, SpellId } from '../../src/spells/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** An ai spell of a weight, with no timeline. */
const aiSpell = (weight: number, canCast?: () => boolean): AnySpellDef<UnitGame> => ({
  activation: { kind: 'ai', windup: 0, weight },
  ...(canCast === undefined ? {} : { canCast }),
  release: () => undefined,
});

/** A draw that always answers `value`. */
const fixed = (value: number) => () => value;

/** A game with a pool of three ai spells: slam (weight 1), bolt (3), and nova, which the gates refuse when closed. */
const picking = () => {
  const gate = { isOpen: true };

  const game = makeUnitGame(
    { beast: {} },
    { spells: { slam: aiSpell(1), bolt: aiSpell(3), nova: aiSpell(4, () => gate.isOpen) } },
  );

  const beast = game.units.spawn(game.id.beast, { side: 1 });
  const { slam, bolt, nova } = game.spellId;
  const pool: readonly SpellId[] = [slam, bolt, nova];

  return { ...game, beast, pool, gate, slam, bolt, nova };
};

describe('the weighted anti-repeat picker (§I.7.1 F17, §II.6 C3)', () => {
  it('draws in proportion to the activations’ weights, over the spells that would start', () => {
    const { ai, beast, pool, gate, slam, bolt, nova } = picking();

    assert.equal(ai.pick(beast, pool, { random: fixed(0), repeat: 'allow' }), slam);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.2), repeat: 'allow' }), bolt);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.6), repeat: 'allow' }), nova);
    gate.isOpen = false;
    assert.equal(ai.pick(beast, pool, { random: fixed(0.99), repeat: 'allow' }), bolt);
    assert.equal(beast.brain.lastPick, bolt);
  });

  it('leaves the last pick out while another fits, and picks it when it is the only one', () => {
    const { ai, beast, pool, bolt, slam } = picking();

    ai.pick(beast, pool, { random: fixed(0.2) });
    assert.equal(
      ai.pick(beast, pool, { random: fixed(0), weight: (_unit, spell) => (spell === slam ? 0 : 1) }),
      pool[2],
    );
    assert.equal(ai.pick(beast, [bolt], { random: fixed(0.5) }), bolt);
    assert.equal(ai.pick(beast, [bolt], { random: fixed(0.5) }), bolt);
  });

  it('takes the game’s weights and filter (a budget), and answers none when nothing fits', () => {
    const { ai, beast, pool, slam, bolt } = picking();
    const allows = (_unit: unknown, spell: SpellId) => spell !== bolt;

    assert.equal(ai.pick(beast, pool, { random: fixed(0.3), allows, weight: () => 1, repeat: 'allow' }), slam);
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

describe('the focus and the movement intent (§II.6 C5, C9)', () => {
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

  it('writes one reused intent per unit, each kind resetting what the last one set', () => {
    const { ai, beast } = picking();
    const intent = ai.intentOf(beast);

    intent.chase(4, 1.5).speed = 1.3;
    assert.deepEqual(
      [intent.kind, intent.target, intent.distance, intent.face, intent.speed],
      ['chase', 4, 1.5, 'target', 1.3],
    );
    intent.moveTo({ x: 2, z: 3 });
    assert.deepEqual(
      [intent.kind, intent.target, intent.point, intent.speed, intent.face],
      ['point', -1, { x: 2, z: 3 }, 1, 'move'],
    );
    assert.equal(intent.hold().face, 'keep');
    assert.equal(intent.keepRange(4, 6).kind, 'keepRange');
    assert.equal(intent.flee(4, 8).distance, 8);
    assert.equal(intent.fleePoint({ x: 1, z: 1 }, 5).target, -1);
    assert.equal(intent.clear().kind, 'none');
    assert.equal(ai.intentOf(beast), intent);
  });
});
