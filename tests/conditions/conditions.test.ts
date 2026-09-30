import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  all,
  any,
  bindCondition,
  compileCondition,
  type ConditionExpr,
  type ConditionTables,
  conditionTest,
  defineConditions,
  defineValues,
  isMirrorSafe,
  not,
  readsWorld
} from '../../src/conditions/index.ts';
import { createModifierSystem, defineSources, defineStats, mul } from '../../src/modifiers/index.ts';

/** A bearer as the tests' conditions read it: health, a stance, and a log of the tests that ran. */
interface Host {
  hp: number;
  readonly maxHp: number;
  stance: number;
  readonly asked: string[];
}

/** A host at a health, with a stance. */
const hostAt = (hp: number, stance = 0): Host => ({ hp, maxHp: 100, stance, asked: [] });

const CONDITIONS = defineConditions({
  hurt: { test: (host: Host) => (host.asked.push('hurt'), host.hp < host.maxHp), mirrorSafe: true },
  inStance: {
    test: (host: Host, stance) => (host.asked.push('inStance'), host.stance === stance),
    mirrorSafe: true
  },
  inSight: { test: (host: Host) => (host.asked.push('inSight'), host.hp > 0), world: true },
  plain: (host: Host) => (host.asked.push('plain'), true)
});

const VALUES = defineValues({
  healthShare: { read: (host: Host) => host.hp / host.maxHp, mirrorSafe: true },
  missing: (host: Host, scale) => (host.maxHp - host.hp) * scale
});

const TABLES = { conditions: CONDITIONS, values: VALUES };

/** The test tables with their names widened, for conditions a test forges on purpose. */
const LOOSE: ConditionTables = TABLES;

/** Compiles and binds a condition over the test tables. */
const bound = (expr: ConditionExpr<keyof typeof CONDITIONS.id, keyof typeof VALUES.id>) =>
  bindCondition(TABLES, compileCondition(TABLES, expr));

describe('compiling a condition', () => {
  it('resolves names to ids, keeps arguments, and moves world tests after the rest in all and any', () => {
    const compiled = compileCondition(
      TABLES,
      all<'hurt' | 'inSight' | 'inStance', 'healthShare'>({ is: 'inSight' }, not({ is: 'inStance', arg: 2 }), {
        value: 'healthShare',
        op: '<=',
        than: 0.5,
        epsilon: 0.01
      })
    );

    assert.deepEqual(compiled, {
      kind: 'all',
      of: [
        { kind: 'not', of: { kind: 'is', condition: CONDITIONS.id.inStance, arg: 2 } },
        {
          kind: 'compare',
          value: VALUES.id.healthShare,
          arg: 0,
          op: '<=',
          than: 0.5,
          epsilon: 0.01
        },
        { kind: 'is', condition: CONDITIONS.id.inSight, arg: 0 }
      ]
    });
    assert.equal(readsWorld(TABLES, compiled), true);
  });

  it('refuses unknown names, empty lists, unknown ops and unsound numbers, naming what it compiles', () => {
    const bad = (expr: object) => () => {
      const forged: ConditionExpr = { is: 'hurt' };

      compileCondition(LOOSE, Object.assign(forged, expr), 'spell nova');
    };

    assert.throws(
      () => compileCondition(LOOSE, { is: 'asleep' }, 'spell nova'),
      /spell nova: there is no condition named asleep/
    );
    assert.throws(() => compileCondition(LOOSE, { value: 'mana', op: '<', than: 1 }), /no value kind named mana/);
    assert.throws(() => compileCondition(TABLES, { all: [] }), /an all condition needs at least one part/);
    assert.throws(() => compileCondition(TABLES, { any: [] }), /an any condition needs at least one part/);
    assert.throws(bad({ is: undefined, value: 'missing', op: '=<', than: 1 }), /op is one of/);
    assert.throws(
      () => compileCondition(TABLES, { value: 'missing', op: '<=', than: 1, epsilon: -1 }),
      /epsilon is from 0/
    );
    assert.throws(() => compileCondition(TABLES, { is: 'hurt', arg: Number.NaN }), /arg must be a finite number/);
    assert.throws(() => compileCondition({}, { is: 'hurt' }), /there is no condition named hurt/);
  });
});

describe('evaluating a condition', () => {
  it('composes all, any and not, stopping at the first part that decides', () => {
    const host = hostAt(40, 1);

    assert.equal(bound(any({ is: 'inStance', arg: 1 }, { is: 'plain' }))(host), true);
    assert.deepEqual(host.asked, ['inStance']);
    assert.equal(bound(all({ is: 'inStance', arg: 2 }, { is: 'plain' }))(host), false);
    assert.equal(bound(not({ is: 'hurt' }))(host), false);
    assert.equal(
      bound(all({ is: 'hurt' }, any({ is: 'inStance', arg: 3 }, not({ is: 'inStance', arg: 3 }))))(host),
      true
    );
  });

  it('asks the world last, and only when the cheaper tests left the answer open', () => {
    const host = hostAt(100);

    assert.equal(bound(all({ is: 'inSight' }, { is: 'hurt' }))(host), false);
    assert.deepEqual(host.asked, ['hurt']);
  });

  it('compares strictly with < and >, and within the epsilon with <=, >=, == and !=', () => {
    const at = (hp: number, expr: ConditionExpr<never, 'healthShare' | 'missing'>) => bound(expr)(hostAt(hp));

    assert.equal(at(50, { value: 'healthShare', op: '<', than: 0.5 }), false);
    assert.equal(at(50, { value: 'healthShare', op: '<=', than: 0.5 }), true);
    assert.equal(at(50.5, { value: 'healthShare', op: '<=', than: 0.5 }), false);
    assert.equal(at(50.5, { value: 'healthShare', op: '<=', than: 0.5, epsilon: 0.01 }), true);
    assert.equal(at(50, { value: 'healthShare', op: '>', than: 0.5 }), false);
    assert.equal(at(49.5, { value: 'healthShare', op: '>=', than: 0.5, epsilon: 0.01 }), true);
    assert.equal(at(70, { value: 'missing', arg: 2, op: '==', than: 60 }), true);
    assert.equal(at(70, { value: 'missing', arg: 2, op: '!=', than: 61, epsilon: 2 }), false);
  });

  it('keeps a lone test as itself with its argument, and binds anything else to one call', () => {
    const lone = conditionTest(TABLES, compileCondition(TABLES, { is: 'inStance', arg: 4 }));
    const composed = conditionTest(TABLES, compileCondition(TABLES, not({ is: 'hurt' })));

    assert.equal(lone.test, CONDITIONS.get(CONDITIONS.id.inStance).test);
    assert.equal(lone.arg, 4);
    assert.equal(composed.arg, 0);
    assert.equal(composed.test(hostAt(100), 0), true);
  });
});

describe('mirror safety', () => {
  it('holds only when every test and value in the condition is flagged mirror-safe', () => {
    const safe = (expr: ConditionExpr<keyof typeof CONDITIONS.id, keyof typeof VALUES.id>) =>
      isMirrorSafe(TABLES, compileCondition(TABLES, expr));

    assert.equal(safe(all({ is: 'hurt' }, { value: 'healthShare', op: '<', than: 1 })), true);
    assert.equal(safe(any({ is: 'hurt' }, { is: 'plain' })), false);
    assert.equal(safe(not({ value: 'missing', op: '>', than: 0 })), false);
    assert.equal(CONDITIONS.get(CONDITIONS.id.plain).isMirrorSafe, false);
  });
});

describe('conditions in the modifier fold', () => {
  it('gate a modifier on a composed condition and a comparison, read at every fold', () => {
    const stats = defineStats({ damage: { base: 1, kind: 'multiplier' } });
    const sources = defineSources(['talents']);

    const modifiers = createModifierSystem({
      stats,
      sources,
      conditions: CONDITIONS,
      values: VALUES
    });

    const sheet = modifiers.createSheet();

    const when = all<'inStance', 'healthShare'>(
      { is: 'inStance', arg: 1 },
      { value: 'healthShare', op: '<=', than: 0.5 }
    );

    modifiers.setSource(sheet, sources.id.talents, [modifiers.compile([mul('damage', 1.5, { when })])]);

    const host = hostAt(80, 1);
    const read = { host };

    assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1);
    host.hp = 50;
    assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1.5);
    host.stance = 0;
    assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1);
    const forged = { value: 'healthShare' as const, op: '<' as const, than: 1 };

    Reflect.set(forged, 'value', 'mana');
    assert.throws(
      () => modifiers.compile([mul('damage', 2, { when: forged })]),
      /when: there is no value kind named mana/
    );
  });
});
