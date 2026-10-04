import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setFocus } from '../../src/ai/index.ts';
import type { AnySpellDef, SpellId } from '../../src/spells/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** A spell a brain picks, with no timeline. */
const aiSpell = (canCast?: () => boolean): AnySpellDef<UnitGame> => ({
  activation: { kind: 'trigger' },
  ...(canCast === undefined ? {} : { canCast }),
  release: () => undefined
});

/** A draw that always answers `value`. */
const fixed = (value: number) => () => value;

/** A game with a pool of three spells: slam (weight 1), bolt (3), and nova (4), which the gates refuse when closed. */
const picking = () => {
  const gate = { isOpen: true };

  const game = makeUnitGame(
    { beast: {} },
    { spells: { slam: aiSpell(), bolt: aiSpell(), nova: aiSpell(() => gate.isOpen) } }
  );

  const beast = game.units.spawn(game.id.beast, { side: 1 });
  const { slam, bolt, nova } = game.spellId;
  const pool: readonly SpellId[] = [slam, bolt, nova];

  const weights = new Map([
    [slam, 1],
    [bolt, 3],
    [nova, 4]
  ]);

  const weight = (_unit: unknown, spell: SpellId): number => weights.get(spell) ?? 0;

  return { ...game, beast, pool, gate, weight, slam, bolt, nova };
};

describe('the weighted picker', () => {
  it('draws in proportion to the game’s weights, over the spells that would start', () => {
    const { ai, beast, pool, gate, weight, slam, bolt, nova } = picking();

    assert.equal(ai.pick(beast, pool, { random: fixed(0), weight }), slam);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.2), weight }), bolt);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.6), weight }), nova);
    gate.isOpen = false;
    assert.equal(ai.pick(beast, pool, { random: fixed(0.99), weight }), bolt);
  });

  it('takes the game’s filter (a budget), weighs 1 by default, and answers none when nothing fits', () => {
    const { ai, beast, pool, slam, bolt } = picking();
    const allows = (_unit: unknown, spell: SpellId) => spell !== bolt;

    assert.equal(ai.pick(beast, pool, { random: fixed(0.3), allows }), slam);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.3), weight: () => 0 }), undefined);
    assert.equal(ai.pick(beast, [], { random: fixed(0.3) }), undefined);
  });

  it('takes no draw when nothing fits, so an empty pick shifts no later draw of the stream', () => {
    const { ai, beast, pool, gate, weight } = picking();
    let draws = 0;

    const random = (): number => {
      draws += 1;

      return 0;
    };

    gate.isOpen = false;
    assert.equal(ai.pick(beast, pool, { random, weight: () => 0 }), undefined);
    assert.equal(ai.pick(beast, pool, { random, allows: () => false }), undefined);
    assert.equal(ai.pick(beast, [], { random }), undefined);
    assert.equal(draws, 0);
    assert.notEqual(ai.pick(beast, pool, { random, weight }), undefined);
    assert.equal(draws, 1);
  });

  it('checks each candidate with its own input when the game gives inputOf', () => {
    const { ai, beast, pool, weight, slam, bolt, nova } = picking();
    const asked: SpellId[] = [];

    const inputOf = (_unit: unknown, spell: SpellId): undefined => {
      asked.push(spell);

      return undefined;
    };

    assert.equal(ai.pick(beast, pool, { random: fixed(0), weight, inputOf }), slam);
    assert.deepEqual(asked, [slam, bolt, nova]);
  });

  it('finds the first spell of an ordered list that would start (a reaction)', () => {
    const { ai, beast, gate, slam, nova } = picking();

    assert.equal(ai.first(beast, [nova, slam]), nova);
    gate.isOpen = false;
    assert.equal(ai.first(beast, [nova, slam]), slam);
    assert.equal(ai.first(beast, [nova, slam], { allows: () => false }), undefined);
  });

  it('refuses a weight that is not finite, and weights whose total is not', () => {
    const { ai, beast, pool, bolt } = picking();

    for (const top of [Number.POSITIVE_INFINITY, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const weight = (_unit: unknown, spell: SpellId): number => (spell === bolt ? top : 1);

      assert.throws(() => ai.pick(beast, pool, { random: fixed(0.5), weight }), RangeError);
    }

    assert.throws(() => ai.pick(beast, pool, { random: fixed(0.5), weight: () => Number.MAX_VALUE }), /add up to/);
    assert.equal(ai.pick(beast, pool, { random: fixed(0.5), weight: () => 1 }), bolt);
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

  it('refuses a focus that is not an entity id, and a setFocus proc naming no focus it knows', () => {
    const { ai, procs, beast } = picking();

    for (const focus of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      assert.throws(() => {
        ai.setFocus(beast, focus);
      }, /entity id/);
    }

    const forged = setFocus<UnitGame>();

    Reflect.set(forged, 'focus', 'targt');
    assert.throws(() => procs.prepare([forged], 'Test'), /targt/);
    assert.doesNotThrow(() => procs.prepare([setFocus<UnitGame>({ focus: 'eventUnit' })], 'Test'));
  });

  it('is left alone by a late setFocus proc on a despawned unit, whose brain the next unit gets', () => {
    const { ai, procs, units, id, beast } = picking();
    const hero = units.spawn(id.beast, { side: 0 });

    units.despawn(beast);

    const next = units.spawn(id.beast, { side: 1 });

    assert.equal(procs.apply(setFocus<UnitGame>(), { self: beast, target: hero }).status, 'skipped');
    assert.deepEqual([ai.focusOf(beast), ai.focusOf(next)], [-1, -1]);
  });
});
