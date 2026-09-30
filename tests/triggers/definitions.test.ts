import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AuraDef, createAuraSystem, defineAuras } from '../../src/auras/index.ts';
import type { IsCondition } from '../../src/conditions/index.ts';
import { checkOrder } from '../../src/core/index.ts';
import { createProcSystem } from '../../src/procs/index.ts';
import {
  cooldownName,
  createTriggerSystem,
  defineTrigger,
  explainTrigger,
  explainTriggers,
  type TriggerFilter,
  triggerName,
  withTriggerCooldowns,
} from '../../src/triggers/index.ts';
import {
  aura,
  CLOCKS,
  CONDITIONS,
  defined,
  type Game,
  invalid,
  makeGame,
  mark,
  TAGS,
  type Unit,
} from '../helpers/trigger-game.ts';

/** A trigger system over `defs` registered as they are (no derived cooldown auras), with or without conditions. */
const bare = (defs: Readonly<Record<string, AuraDef<Game>>>, hasConditions = true) => {
  const game = makeGame({});
  const auras = createAuraSystem<Game>({ registry: defineAuras<Game, string>(defs), tags: TAGS, clocks: CLOCKS });
  const procs = createProcSystem<Game>({ kinds: game.procs.kinds, auras, host: game.host });
  const base = { auras, procs, bus: game.bus, events: game.events };

  return hasConditions
    ? createTriggerSystem<Game, Unit>({ ...base, conditions: { table: CONDITIONS, host: (unit) => unit } })
    : createTriggerSystem<Game, Unit>(base);
};

describe('validation at load', () => {
  it('refuses every invalid trigger at once, each named by its address', () => {
    const noop = mark('x');

    assert.throws(
      () =>
        makeGame({
          fine: aura({ duration: 1, triggers: [{ on: 'hit', do: [noop] }] }),
          odds: aura({
            duration: 1,
            triggers: [
              { on: 'hit', chance: 0, do: [noop] },
              { on: 'hit', chance: 1.5, do: [noop] },
            ],
          }),
          cool: aura({
            duration: 1,
            triggers: [
              { on: 'hit', icd: 0, do: [noop] },
              { on: 'hit', icd: Infinity, do: [noop] },
            ],
          }),
          idle: aura({ duration: 1, triggers: [{ on: 'hit', do: [] }] }),
          lost: aura({
            duration: 1,
            triggers: [
              invalid(defineTrigger<Game>({ on: 'hit', do: [noop] }), { on: 'dodge' }),
              {
                on: 'hit',
                when: [invalid<TriggerFilter<Game>>({ filter: 'isCrit' }, { filter: 'parry' })],
                do: [noop],
              },
              {
                on: 'hit',
                when: [invalid<IsCondition<'healthBelow'>>({ is: 'healthBelow' }, { is: 'enraged' })],
                do: [noop],
              },
              { on: 'hit', do: [{ kind: 'applyAura', aura: 'nowhere' }] },
              { on: 'kill', when: [{ filter: 'minAmount', arg: 'lots' }], do: [noop] },
              { on: 'aura', when: [{ filter: 'change', arg: 'vanished' }], do: [noop] },
            ],
          }),
        }),
      {
        name: 'RangeError',
        message: [
          'Invalid triggers:',
          'Trigger aura.odds.0: chance 0 is outside (0, 1].',
          'Trigger aura.odds.1: chance 1.5 is outside (0, 1].',
          'Trigger aura.cool.0: icd 0 is not a positive, finite number of seconds.',
          'Trigger aura.cool.1: icd Infinity is not a positive, finite number of seconds.',
          'Trigger aura.idle.0: does nothing (an empty do).',
          'Trigger aura.lost.0: answers dodge, which is not a trigger event.',
          'Trigger aura.lost.1: unknown filter parry.',
          'Trigger aura.lost.2: when: there is no condition named enraged.',
          'Trigger aura.lost.3: unknown aura nowhere.',
          'Trigger aura.lost.4: filter minAmount takes a number.',
          'Trigger aura.lost.5: unknown aura change vanished.',
        ].join('\n'),
      },
    );
  });

  it('refuses an icd whose cooldown aura the registry lacks, and a trigger that is not one', () => {
    const shapeless = invalid(defineTrigger<Game>({ on: 'hit', do: [mark('x')] }), { do: 'nothing' });
    const solo = aura({ duration: 1, triggers: [{ on: 'hit', icd: 1, do: [mark('x')] }, shapeless] });

    assert.throws(() => bare({ solo }), {
      message: [
        'Invalid triggers:',
        'Trigger aura.solo.0: has an icd, but the aura registry has no icd.aura.solo.0 (build it with withTriggerCooldowns).',
        'Trigger aura.solo.1: is not a trigger (it needs on and do).',
      ].join('\n'),
    });
  });

  it('refuses conditions when the system has none, and hears other than self or party', () => {
    const loud = invalid(defineTrigger<Game>({ on: 'hit', do: [mark('x')] }), { hears: 'world' });
    const test = aura({ duration: 1, triggers: [{ on: 'hit', when: [{ is: 'healthBelow' }], do: [mark('x')] }] });

    assert.throws(() => bare({ test, loud: aura({ duration: 1, triggers: [loud] }) }, false), {
      message: [
        'Invalid triggers:',
        'Trigger aura.test.0: tests a condition, but the system has no conditions.',
        'Trigger aura.loud.0: hears must be self or party; got world.',
      ].join('\n'),
    });
  });

  it('leaves the definitions as they were: frozen, never written', () => {
    const def = aura({ duration: 1, triggers: [{ on: 'hit', chance: 0.5, do: [mark('x')] }] });
    const { registry } = makeGame({ def }, { triggers: { random: () => 0 } });

    assert.equal(Object.isFrozen(def.triggers?.[0]), true);
    assert.equal(registry.get(registry.id.def).triggers?.[0]?.chance, 0.5);
  });
});

describe('internal cooldowns as derived auras', () => {
  const noop = mark('x');

  const authored = {
    rush: aura({
      duration: 5,
      triggers: [
        { on: 'hit', icd: 2, do: [noop] },
        { on: 'hit', do: [noop] },
        { on: 'kill', icd: 0.5, do: [noop] },
      ],
    }),
    calm: aura({ duration: 5 }),
    zeal: aura({ duration: 5, triggers: [{ on: 'hit', icd: 3, do: [noop] }] }),
  };

  it('names triggers and their cooldowns by address', () => {
    assert.equal(triggerName('rush', 2), 'aura.rush.2');
    assert.equal(cooldownName('rush', 2), 'icd.aura.rush.2');
  });

  it('derives one refresh, owner-only aura per icd, after the authored auras, with the given clock and tags', () => {
    const all = withTriggerCooldowns<Game, keyof typeof authored>(authored, { tags: ['cooldown'], clock: 'world' });

    assert.deepEqual(all.order, ['rush', 'calm', 'zeal', 'icd.aura.rush.0', 'icd.aura.rush.2', 'icd.aura.zeal.0']);
    assert.deepEqual(all.defs['icd.aura.rush.2'], {
      duration: 0.5,
      stacking: 'refresh',
      audience: 'owner',
      clock: 'world',
      tags: ['cooldown'],
    });
  });

  it('keeps the pinned order: a retired cooldown keeps its slot, a new one is appended', () => {
    const pinned = ['icd.aura.zeal.0', 'icd.aura.gone.0', 'icd.aura.rush.0'];
    const all = withTriggerCooldowns<Game, keyof typeof authored>(authored, { order: pinned });
    const registry = defineAuras<Game, string>(all.defs, { order: all.order });

    checkOrder(registry, ['rush', 'calm', 'zeal', ...pinned, 'icd.aura.rush.2']);
    assert.equal(registry.isRetired(defined(registry.id['icd.aura.gone.0'])), true);
  });

  it('refuses a pinned name that is not a cooldown and an authored aura named like one', () => {
    const { calm, rush } = authored;

    assert.throws(() => withTriggerCooldowns<Game, 'calm'>({ calm }, { order: ['calm'] }), /is not an internal/);
    assert.throws(
      () => withTriggerCooldowns<Game, 'rush' | 'icd.aura.rush.0'>({ rush, 'icd.aura.rush.0': calm }),
      /named like an internal-cooldown aura/,
    );
  });
});

describe('explainTrigger', () => {
  it('explains a trigger as data, with its address, odds, cooldown, conditions and procs', () => {
    const game = makeGame(
      {
        calm: aura({ duration: 5 }),
        rush: aura({
          duration: 5,
          triggers: [
            { on: 'kill', do: [mark('x')] },
            {
              on: 'hit',
              hears: 'party',
              chance: 0.25,
              icd: 1.5,
              when: [
                { is: 'healthBelow', arg: 0.5 },
                { filter: 'minAmount', arg: 30 },
                { filter: 'aura', arg: 'calm' },
              ],
              do: [{ kind: 'applyAura', aura: 'calm', to: 'eventUnit', duration: 2 }],
            },
          ],
        }),
      },
      { triggers: { random: () => 0 } },
    );

    assert.deepEqual(explainTrigger(game.triggers, game.id.rush, 1), {
      kind: 'trigger',
      trigger: 1,
      aura: game.id.rush,
      index: 1,
      event: game.bus.kind.hit,
      hears: 'party',
      chance: 0.25,
      icd: 1.5,
      cooldown: game.id['icd.aura.rush.1'],
      when: [
        { kind: 'condition', condition: { kind: 'is', condition: CONDITIONS.id.healthBelow, arg: 0.5 } },
        { kind: 'filter', filter: 0, arg: 30, isCarried: true },
        { kind: 'filter', filter: 2, arg: game.id.calm, isCarried: false },
      ],
      do: [
        { kind: 'proc', proc: 0, chance: 1, to: 'eventUnit', values: { aura: game.id.calm, duration: 2 }, procs: [] },
      ],
    });
    assert.deepEqual(game.triggers.filters, ['minAmount', 'isCrit', 'aura', 'change']);
    assert.equal(explainTriggers(game.triggers, game.id.rush).length, 2);
    assert.deepEqual(explainTriggers(game.triggers, game.id.calm), []);
    assert.throws(() => explainTrigger(game.triggers, game.id.rush, 2), /has no trigger 2/);
    assert.equal(game.triggers.count, 2);
    assert.equal(game.triggers.idOf(game.id.rush, 1), 1);
    assert.deepEqual(game.triggers.events, [game.bus.kind.hit, game.bus.kind.kill]);
  });
});
