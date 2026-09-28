import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type BlowStep, DAMAGE_STAGES, FORCE_STAGES, HEAL_STAGES } from '../../src/damage/index.ts';
import { type DamageOverrides, makeDamageGame } from '../helpers/damage-game.ts';
import { invalid } from '../helpers/trigger-game.ts';

describe('the damage pipeline order (§II.6 D1)', () => {
  it('runs the built-in stages in their documented order', () => {
    const { damage } = makeDamageGame({});

    assert.deepEqual(damage.stages, [
      'ignore',
      'outgoing',
      'crit',
      'block',
      'crushing',
      'mitigation',
      'absorb',
      'lethal',
      'health',
      'dealt',
      'outcome',
      'knock',
      'death',
    ]);
    assert.deepEqual(damage.stages, DAMAGE_STAGES);
    assert.deepEqual(damage.healStages, HEAL_STAGES);
    assert.deepEqual(damage.forceStages, FORCE_STAGES);
  });

  it('inserts game stages at their positions, several at one position in declaration order', () => {
    const { damage } = makeDamageGame(
      {},
      {
        stages: {
          window: { before: 'ignore', run: () => undefined },
          shelter: { after: 'ignore', run: () => undefined },
          horde: { after: 'ignore', run: () => undefined },
          grace: { before: 'ignore', run: () => undefined },
          wound: { after: 'shelter', run: () => undefined },
          shove: { after: 'health', run: () => undefined },
        },
      },
    );

    assert.deepEqual(damage.stages.slice(0, 7), ['window', 'grace', 'ignore', 'shelter', 'wound', 'horde', 'outgoing']);
    assert.deepEqual(damage.stages.slice(13, 16), ['health', 'shove', 'dealt']);
    assert.deepEqual(damage.gameStages, [
      'damage.window',
      'damage.shelter',
      'damage.horde',
      'damage.grace',
      'damage.wound',
      'damage.shove',
    ]);
  });

  it('records every stage of a traced blow, with the amount and status after it', () => {
    const { damage, unit } = makeDamageGame({});
    const trace: BlowStep[] = [];

    damage.hit({ target: unit(1), amount: 30, kind: damage.kinds.id.fire, trace });

    assert.deepEqual(
      trace.map((step) => `${step.stage}:${step.amount}:${step.status}`),
      [
        'ignore:30:landed',
        'outgoing:30:landed',
        'crit:30:landed',
        'block:30:landed',
        'crushing:30:landed',
        'mitigation:30:landed',
        'absorb:30:landed',
        'lethal:30:landed',
        'health:30:landed',
        'dealt:30:landed',
        'outcome:30:landed',
        'knock:30:landed',
        'death:30:landed',
      ],
    );
  });
});

describe('a blow', () => {
  it('lands on health: the amount after every stage, what it took, and whether it killed', () => {
    const { damage, unit } = makeDamageGame({});
    const target = unit(1);
    const blow = damage.hit({ target, amount: 30 });

    assert.equal(blow.status, 'landed');
    assert.equal(blow.amount, 30);
    assert.equal(blow.base, 30);
    assert.equal(blow.healthBefore, 100);
    assert.equal(blow.healthAfter, 70);
    assert.equal(blow.dealt, 30);
    assert.equal(blow.hasKilled, false);
    assert.equal(blow.kind, damage.kinds.id.physical);
    assert.equal(target.hp, 70);
  });

  it('hands the host health below 0 on overkill, and counts only the health there was as dealt', () => {
    const { damage, unit, log } = makeDamageGame({});
    const target = unit(1);
    const blow = damage.hit({ target, amount: 130, attacker: unit(2) });

    assert.equal(target.hp, -30);
    assert.equal(blow.dealt, 100);
    assert.equal(blow.hasKilled, true);
    assert.deepEqual(log, ['remove@1']);
  });

  it('is skipped, running no stage, with no amount, a NaN amount, or on a dead target', () => {
    const calls: string[] = [];

    const { damage, unit } = makeDamageGame(
      {},
      {
        stages: {
          probe: {
            before: 'ignore',

            run: () => {
              calls.push('probe');

              return undefined;
            },
          },
        },
      },
    );

    const dead = unit(2);

    dead.hp = 0;

    assert.equal(damage.hit({ target: unit(1), amount: 0 }).status, 'skipped');
    assert.equal(damage.hit({ target: unit(1), amount: Number.NaN }).status, 'skipped');
    assert.equal(damage.hit({ target: dead, amount: 10 }).status, 'skipped');
    assert.equal(damage.hit({ target: dead, amount: 10 }).amount, 0);
    assert.deepEqual(calls, []);
  });

  it('is ended by a game stage: the rest of the blow stages are skipped, the after-stages still run', () => {
    const seen: string[] = [];

    const { damage, unit } = makeDamageGame(
      {},
      {
        stages: {
          parry: { after: 'crit', run: () => 'blocked' },

          afterMath: {
            after: 'health',

            run: (blow) => {
              seen.push(`${blow.status} ${blow.amount} ${blow.base}`);

              return undefined;
            },
          },
        },
      },
    );

    const target = unit(1);
    const blow = damage.hit({ target, amount: 40 });

    assert.equal(blow.status, 'blocked');
    assert.equal(target.hp, 100);
    assert.deepEqual(seen, ['blocked 0 40']);
  });

  it('lets a game stage change the amount and the game fields, and reads the system it is handed', () => {
    const { damage, unit } = makeDamageGame(
      {},
      {
        stages: {
          double: {
            before: 'mitigation',

            run: (blow, system) => {
              blow.amount *= system.kinds.size;

              return undefined;
            },
          },
        },
      },
    );

    const target = unit(1);

    damage.hit({ target, amount: 5, kind: damage.kinds.id.fire });
    assert.equal(target.hp, 85);
  });

  it('credits its source: the spec’s, else the attacker’s id', () => {
    const { damage, unit } = makeDamageGame({});

    assert.equal(damage.hit({ target: unit(1), amount: 1, attacker: unit(7) }).source, 7);
    assert.equal(damage.hit({ target: unit(1), amount: 1, attacker: unit(7), source: 9 }).source, 9);
    assert.equal(damage.hit({ target: unit(1), amount: 1 }).source, -1);
  });

  it('is skipped past the nesting cap', () => {
    const statuses: string[] = [];

    const { damage, unit } = makeDamageGame(
      {},
      {
        maxDepth: 2,
        stages: {
          echo: {
            after: 'health',

            run: (blow, system) => {
              const nested = system.hit({ target: blow.target, amount: 1 });

              statuses.push(`${system.depth} ${nested.status}`);

              return undefined;
            },
          },
        },
      },
    );

    damage.hit({ target: unit(1), amount: 1 });
    assert.deepEqual(statuses, ['2 skipped', '1 landed']);
  });
});

describe('the load-time checks', () => {
  it('refuse a game stage with an unknown anchor, two anchors, none, or a taken name', () => {
    const run = (): undefined => undefined;

    assert.throws(() => makeDamageGame({}, { stages: { x: { after: 'nowhere', run } } }), /no stage nowhere/);
    assert.throws(() => makeDamageGame({}, { stages: { x: { after: 'crit', before: 'crit', run } } }), /exactly one/);
    assert.throws(() => makeDamageGame({}, { stages: { x: { run } } }), /exactly one/);
    assert.throws(() => makeDamageGame({}, { stages: { crit: { after: 'ignore', run } } }), /name is taken/);
    assert.throws(() => makeDamageGame({}, { healStages: { x: { after: 'crit', run } } }), /Heal stage x/);
  });

  it('refuse stats of the wrong kind, and stages that read what the host lacks', () => {
    assert.throws(() => makeDamageGame({}, { outgoing: ['armor'] }), /armor must be a multiplier stat/);
    assert.throws(
      () => makeDamageGame({}, { crit: { chance: 'power', damage: 'critDamage' } }),
      /power must be a flat/,
    );
    assert.throws(() => makeDamageGame({}, invalid<DamageOverrides>({}, { outgoing: ['nothing'] })), /no stat nothing/);
    assert.throws(
      () => makeDamageGame({}, invalid<DamageOverrides>({}, { heal: { blockedBy: ['nothing'] } })),
      /no aura tag nothing/,
    );
    assert.throws(() => makeDamageGame({}, { maxDepth: 0 }), /maxDepth/);
  });
});
