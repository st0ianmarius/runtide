import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBus } from '../../src/core/index.ts';
import { createDamageEvent, damageTriggerEvent, defineRollTable, type RollRow } from '../../src/damage/index.ts';
import { add, scaled } from '../../src/modifiers/index.ts';
import { type Game, KINDS, makeDamageGame, STATS } from '../helpers/damage-game.ts';

/** The test table's rows: a miss, a dodge that grows with the defender's block chance, a glancing blow and a crit. */
const ROWS = {
  miss: { effect: 'avoid', chance: 0.1 },
  dodge: { effect: 'avoid', chance: scaled(0.2, add('blockChance', 1, { from: 'target' })) },
  glancing: { effect: 'scale', chance: 0.1, multiplier: 0.5 },
  crit: { effect: 'scale', chance: 'critChance', multiplier: 'critDamage', isCrit: true },
} as const;

/** WoW's attack table over the test rows. */
const SINGLE = defineRollTable(STATS, { mode: 'single', rows: ROWS });

/** The same rows rolled one by one. */
const INDEPENDENT = defineRollTable(STATS, { mode: 'independent', rows: ROWS });

describe('the single roll table (WoW)', () => {
  it('draws once and lets the rows take their chances of it in order, the first it falls in deciding', () => {
    const outcome = (draw: number, blockChance = 0) => {
      const { damage, unit, set, rolls, log } = makeDamageGame({}, { rolls: SINGLE });
      const [attacker, target] = [unit(1), unit(2)];

      set(attacker, 'critChance', 0.2);
      set(target, 'blockChance', blockChance);
      rolls.push(draw);

      const blow = damage.hit({ target, attacker, amount: 10 });

      return [blow.outcome, blow.status, blow.amount, blow.isCrit, log.length];
    };

    assert.deepEqual(outcome(0.05), ['miss', 'avoided', 0, false, 1]);
    assert.deepEqual(outcome(0.25), ['dodge', 'avoided', 0, false, 1]);
    assert.deepEqual(outcome(0.35), ['glancing', 'landed', 5, false, 1]);
    assert.deepEqual(outcome(0.45), ['crit', 'landed', 20, true, 1]);
    assert.deepEqual(outcome(0.65), [undefined, 'landed', 10, false, 1]);
    assert.deepEqual(outcome(0.35, 0.1), ['dodge', 'avoided', 0, false, 1]);
  });

  it('leaves out the rows a blow skips, so the later ones move up the table', () => {
    const { damage, unit, rolls } = makeDamageGame({}, { rolls: SINGLE });
    const target = unit(2);

    rolls.push(0.05, 0.25);
    assert.equal(damage.hit({ target, amount: 10, skips: ['miss'] }).outcome, 'dodge');
    assert.equal(damage.hit({ target, amount: 10, skips: ['miss', 'dodge'] }).outcome, undefined);
  });
});

describe('independent rolls (LoL and swarm)', () => {
  it('draws for each row in order, an avoid ending the blow and a scale applying and going on', () => {
    const { damage, unit, set, rolls, log } = makeDamageGame({}, { rolls: INDEPENDENT });
    const [attacker, target] = [unit(1), unit(2)];

    set(attacker, 'critChance', 0.5);
    rolls.push(0.5, 0.5, 0.05, 0.1);

    const blow = damage.hit({ target, attacker, amount: 10 });

    assert.deepEqual([blow.outcome, blow.amount, blow.isCrit], ['crit', 10, true]);
    assert.deepEqual(log, ['roll miss 0.5', 'roll dodge 0.5', 'roll glancing 0.05', 'roll crit 0.1']);
    rolls.push(0.05);
    assert.equal(damage.hit({ target, attacker, amount: 10 }).status, 'avoided');
  });

  it('never avoids or blocks true damage, which still crits', () => {
    const { damage, unit, set, rolls, log } = makeDamageGame({}, { rolls: INDEPENDENT });
    const [attacker, target] = [unit(1), unit(2)];

    set(attacker, 'critChance', 1);
    rolls.push(0.5);

    const blow = damage.hit({ target, attacker, amount: 10, kind: KINDS.id.pure });

    assert.deepEqual([blow.status, blow.isCrit, blow.amount], ['landed', true, 20]);
    assert.deepEqual(log, ['roll glancing 0.5']);
  });
});

describe('the roll table as data', () => {
  it('explains each row’s chance and multiplier for a pair, by a spell’s shares', () => {
    const { damage, unit, set, shares } = makeDamageGame({}, { rolls: SINGLE });
    const [attacker, target] = [unit(1), unit(2)];

    set(attacker, 'critChance', 0.4);
    set(target, 'blockChance', 0.9);
    shares.set(`7:${STATS.id.critChance}`, 0.5);

    assert.deepEqual(damage.explainRolls(target, { attacker, spell: 7 }), [
      { outcome: 'miss', effect: 'avoid', chance: 0.1, multiplier: undefined },
      { outcome: 'dodge', effect: 'avoid', chance: 1, multiplier: undefined },
      { outcome: 'glancing', effect: 'scale', chance: 0.1, multiplier: 0.5 },
      { outcome: 'crit', effect: 'scale', chance: 0.2, multiplier: 2 },
    ]);
    assert.deepEqual(makeDamageGame({}).damage.explainRolls(target), []);
  });

  it('refuses a bad mode or effect, a multiplier out of place, too many rows and unknown stats, at load', () => {
    const table = (rows: Readonly<Record<string, RollRow<keyof typeof STATS.id>>>) => () =>
      defineRollTable(STATS, { mode: 'independent', rows });

    const forged: RollRow<'critChance'> = { effect: 'avoid', chance: 0.1 };

    Reflect.set(forged, 'effect', 'parry');
    assert.throws(table({ parry: forged }), /roll row parry: its effect is avoid, block or scale/);
    assert.throws(table({ miss: { effect: 'avoid', chance: 0.1, multiplier: 2 } }), /a scale row takes a multiplier/);
    assert.throws(
      table(Object.fromEntries(Array.from({ length: 33 }, (_unused, i) => [`r${i}`, { effect: 'avoid', chance: 0 }]))),
      /at most 32 rows/,
    );

    const mode = { mode: 'single' as const, rows: {} };

    Reflect.set(mode, 'mode', 'double');
    assert.throws(() => defineRollTable(STATS, mode), /mode is single or independent/);
  });

  it('gives triggers an outcome filter by row name', () => {
    const bus = createBus({ taken: () => createDamageEvent<Game>() });
    const event = damageTriggerEvent<Game>(bus.kind.taken, { about: 'target', kinds: KINDS, rolls: SINGLE });
    const filter = event.filters['outcome'];
    const { damage, unit, rolls, auras } = makeDamageGame({}, { rolls: SINGLE });

    rolls.push(0.25);

    const payload = { blow: damage.hit({ target: unit(2), amount: 10 }) };

    assert.equal(filter?.resolve?.('dodge', auras.registry), 1);
    assert.throws(() => filter?.resolve?.('parry', auras.registry), /unknown outcome parry/);
    assert.equal(filter?.test(payload, 1), true);
    assert.equal(filter?.test(payload, 0), false);
  });
});
