import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  against,
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
import {
  againstValue,
  createModifierSystem,
  defineSources,
  defineStats,
  mul,
  plus
} from '../../src/modifiers/index.ts';

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
    assert.equal(composed.test(hostAt(100), 0, undefined), true);
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

describe('conditions against another unit', () => {
  it('ask the other unit as the host, the read’s host as its other, and never hold without one', () => {
    const low = bound(against({ is: 'hurt' }));
    const share = bound(against({ value: 'healthShare', op: '<', than: 0.5 }));
    const notLow = bound(not(against({ is: 'hurt' })));

    assert.equal(low(hostAt(100), hostAt(40)), true);
    assert.equal(low(hostAt(40), hostAt(100)), false);
    assert.equal(low(hostAt(40)), false);
    assert.equal(share(hostAt(100), hostAt(40)), true);
    assert.equal(share(hostAt(100)), false);
    assert.equal(notLow(hostAt(100)), true);
  });

  it('hand every test and value read the unit the read is against', () => {
    const seen: string[] = [];

    const tables = {
      conditions: defineConditions({
        near: (host: Host, reach, other: Host | undefined) => (seen.push(`${host.hp}>${other?.hp}`), reach > 0)
      }),
      values: defineValues({ gap: (host: Host, _arg, other: Host | undefined) => host.hp - (other?.hp ?? 0) })
    };

    const near = bindCondition(tables, compileCondition(tables, { is: 'near', arg: 1 }));
    const gap = bindCondition(tables, compileCondition(tables, { value: 'gap', op: '>', than: 10 }));
    const flipped = conditionTest(tables, compileCondition(tables, against({ is: 'near', arg: 1 })));

    assert.equal(near(hostAt(90), hostAt(30)), true);
    assert.equal(gap(hostAt(90), hostAt(30)), true);
    assert.equal(gap(hostAt(30), hostAt(90)), false);
    assert.equal(flipped.test(hostAt(90), 0, hostAt(30)), true);
    assert.deepEqual(seen, ['90>30', '30>90']);
  });

  it('read the world and mirror safety of what they ask', () => {
    assert.equal(readsWorld(TABLES, compileCondition(TABLES, against({ is: 'inSight' }))), true);
    assert.equal(isMirrorSafe(TABLES, compileCondition(TABLES, against({ is: 'hurt' }))), true);
    assert.equal(isMirrorSafe(TABLES, compileCondition(TABLES, against({ is: 'plain' }))), false);
  });

  it('gate a modifier and value one in the fold only on a read against a unit, kept totals and all', () => {
    const stats = defineStats({ damage: { base: 1, kind: 'multiplier' }, reach: { base: 0, kind: 'flat' } });
    const sources = defineSources(['talents']);

    const modifiers = createModifierSystem({
      stats,
      sources,
      conditions: CONDITIONS,
      values: VALUES,
      revision: () => 0
    });

    const sheet = modifiers.createSheet();

    modifiers.setSource(sheet, sources.id.talents, [
      modifiers.compile([
        mul('damage', 1.5, { when: against({ is: 'hurt' }) }),
        plus('damage', againstValue('missing', 0.01)),
        plus('reach', againstValue('missing', 1))
      ])
    ]);

    const host = hostAt(100);
    const plain = { host };
    const versus = { host, against: hostAt(40) };

    assert.equal(modifiers.resolve(sheet, stats.id.damage, plain), 1);
    assert.equal(modifiers.resolve(sheet, stats.id.damage, versus), (1 + 0.6) * 1.5);
    assert.equal(modifiers.resolve(sheet, stats.id.damage, plain), 1);
    assert.equal(modifiers.explainStat(sheet, stats.id.damage, versus).total, (1 + 0.6) * 1.5);
    // A value read against a unit alone: the plain total is kept, and must not stand for the read against one.
    assert.equal(modifiers.resolve(sheet, stats.id.reach, plain), 0);
    assert.equal(modifiers.resolve(sheet, stats.id.reach, versus), 60);
    assert.equal(modifiers.resolve(sheet, stats.id.reach, plain), 0);
  });
});
