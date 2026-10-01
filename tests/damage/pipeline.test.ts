import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type BlowStep, DAMAGE_STAGES, defineRollTable, FORCE_STAGES, HEAL_STAGES } from '../../src/damage/index.ts';
import { type DamageOverrides, makeDamageGame, STATS } from '../helpers/damage-game.ts';
import { invalid } from '../helpers/trigger-game.ts';

describe('the damage pipeline order', () => {
  it('runs the built-in stages in their documented order, one stage per mitigation row in the rows’ order', () => {
    const { damage } = makeDamageGame({});

    assert.deepEqual(damage.stages, [
      'ignore',
      'outgoing',
      'roll',
      'mitigation.armor',
      'mitigation.taken',
      'absorb',
      'lethal',
      'health',
      'dealt',
      'outcome',
      'death'
    ]);
    assert.deepEqual(
      damage.stages.filter((stage) => stage !== 'mitigation.taken').map((stage) => stage.replace(/\..*/, '')),
      DAMAGE_STAGES
    );
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
          scar: { after: 'wound', run: () => undefined },
          dusk: { after: 'ignore', run: () => undefined }
        }
      }
    );

    assert.deepEqual(damage.stages.slice(0, 9), [
      'window',
      'grace',
      'ignore',
      'shelter',
      'wound',
      'scar',
      'horde',
      'dusk',
      'outgoing'
    ]);
    assert.deepEqual(damage.stages.slice(14, 17), ['health', 'shove', 'dealt']);
    assert.deepEqual(damage.gameStages, [
      'damage.window',
      'damage.shelter',
      'damage.horde',
      'damage.grace',
      'damage.wound',
      'damage.shove',
      'damage.scar',
      'damage.dusk'
    ]);
  });

  it('places a game stage between two mitigation rows, or around them all by the group’s name', () => {
    const run = (): undefined => undefined;

    const { damage } = makeDamageGame(
      {},
      {
        stages: {
          between: { after: 'mitigation.armor', run },
          early: { before: 'mitigation', run },
          late: { after: 'mitigation', run }
        }
      }
    );

    assert.deepEqual(damage.stages.slice(3, 8), ['early', 'mitigation.armor', 'between', 'mitigation.taken', 'late']);
  });

  it('puts a stage placed after an anchor past one placed before a stage that hangs from it', () => {
    const { damage } = makeDamageGame(
      {},
      {
        stages: {
          shelter: { after: 'ignore', run: () => undefined },
          brace: { before: 'shelter', run: () => undefined },
          horde: { after: 'ignore', run: () => undefined }
        }
      }
    );

    assert.deepEqual(damage.stages.slice(0, 5), ['ignore', 'brace', 'shelter', 'horde', 'outgoing']);
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
        'roll:30:landed',
        'mitigation.armor:30:landed',
        'mitigation.taken:30:landed',
        'absorb:30:landed',
        'lethal:30:landed',
        'health:30:landed',
        'dealt:30:landed',
        'outcome:30:landed',
        'death:30:landed'
      ]
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
    assert.equal(blow.overkill, 0);
    assert.equal(blow.hasKilled, false);
    assert.equal(blow.kind, damage.kinds.id.physical);
    assert.equal(target.hp, 70);
  });

  it('hands the host health below 0 on overkill, and counts only the health there was as dealt, the rest overkill', () => {
    const { damage, unit, log } = makeDamageGame({});
    const target = unit(1);
    const blow = damage.hit({ target, amount: 130, attacker: unit(2) });

    assert.equal(target.hp, -30);
    assert.equal(blow.dealt, 100);
    assert.equal(blow.overkill, 30);
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
            }
          }
        }
      }
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
          parry: { after: 'roll', run: () => 'blocked' },

          afterMath: {
            after: 'health',

            run: (blow) => {
              seen.push(`${blow.status} ${blow.amount} ${blow.base}`);

              return undefined;
            }
          }
        }
      }
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
            }
          }
        }
      }
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
            }
          }
        }
      }
    );

    damage.hit({ target: unit(1), amount: 1 });
    assert.deepEqual(statuses, ['2 skipped', '1 landed']);
    assert.equal(damage.dropped, 1);
  });
});

describe('the load-time checks', () => {
  it('refuse a game stage with an unknown anchor, two anchors, none, or a taken name', () => {
    const run = (): undefined => undefined;

    assert.throws(() => makeDamageGame({}, { stages: { x: { after: 'nowhere', run } } }), /no stage nowhere/);
    assert.throws(() => makeDamageGame({}, { stages: { x: { after: 'roll', before: 'roll', run } } }), /exactly one/);
    assert.throws(() => makeDamageGame({}, { stages: { x: { run } } }), /exactly one/);
    assert.throws(() => makeDamageGame({}, { stages: { roll: { after: 'ignore', run } } }), /name is taken/);
    assert.throws(() => makeDamageGame({}, { healStages: { x: { after: 'roll', run } } }), /Heal stage x/);
  });

  it('refuse stats of the wrong kind, and stages that read what the host lacks', () => {
    assert.throws(() => makeDamageGame({}, { outgoing: ['armor'] }), /armor must be a multiplier stat/);
    assert.throws(
      () =>
        defineRollTable(STATS, {
          mode: 'independent',
          rows: { crit: { effect: 'scale', chance: 'critChance' } }
        }),
      /roll row crit: a scale row takes a multiplier/
    );
    assert.throws(() => makeDamageGame({}, invalid<DamageOverrides>({}, { outgoing: ['nothing'] })), /no stat nothing/);
    assert.throws(
      () => makeDamageGame({}, invalid<DamageOverrides>({}, { heal: { received: 'nothing' } })),
      /no stat nothing/
    );
    assert.throws(() => makeDamageGame({}, { maxDepth: 0 }), /maxDepth/);
    assert.throws(() => makeDamageGame({}, { maxKillChain: 1.5 }), /maxKillChain/);
  });
});
