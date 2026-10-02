import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type BlowPayload,
  type CombatEntry,
  type CombatLog,
  createCombatLog,
  createDamageMeter,
  ENTRY_KILLED
} from '../../src/combat-log/index.ts';
import { createBus } from '../../src/core/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { aura, type Game, makeSpellGame, spell } from '../helpers/spell-game.ts';

/** A game whose spells deal damage, heal and apply an aura, with an area trigger kind and a shield. */
const logGame = () =>
  makeSpellGame(
    {
      bolt: spell({
        activation: { kind: 'trigger' },
        target: (_ctx, input) => input,

        release: (_ctx, target) => (target === undefined ? undefined : [{ kind: 'damage', amount: 30, to: target }])
      })
    },
    {
      auras: {
        shield: aura({ duration: 'infinite', onIgnore: () => true }),
        mark: aura({ duration: 1 })
      },
      areaTriggers: { pool: { shape: circle(1), lifetime: 0.5 } }
    }
  );

/** A combat log over a test game's bus, recording everything. */
const logOf = (game: ReturnType<typeof logGame>, capacity?: number): CombatLog => {
  const { bus } = game;

  return createCombatLog<Game['bearer'], Game['spell']>({
    bus,
    clock: game.clock,
    idOf: (unit) => unit.id,
    ...(capacity === undefined ? {} : { capacity }),
    damage: {
      taken: bus.kind.taken,
      ignored: bus.kind.ignored,
      healed: bus.kind.healed,
      death: bus.kind.death
    },
    auras: bus.kind.aura,
    spells: { start: bus.kind.spellStart, release: bus.kind.spellRelease, end: bus.kind.spellEnd },
    areaTriggers: { spawned: bus.kind.areaSpawned, ended: bus.kind.areaEnded }
  });
};

/** Every held entry, as `kind source>target amount` lines. */
const linesOf = (log: CombatLog): string[] => {
  const entry: CombatEntry = log.createEntry();
  const lines: string[] = [];

  for (let seq = log.first; seq < log.total; seq++) {
    if (log.read(seq, entry)) {
      lines.push(`${entry.tick} ${entry.kind} ${entry.source}>${entry.target} ${entry.amount}`);
    }
  }

  return lines;
};

describe('the combat log', () => {
  it('records a blow before what its after-stages set off (a lifesteal, an on-hit blow), from the resolved event', () => {
    const game = logGame();
    const [hero, foe] = [game.unit(1), game.unit(100)];

    const log = createCombatLog<Game['bearer'], Game['spell']>({
      bus: game.bus,
      clock: game.clock,
      idOf: (unit) => unit.id,
      damage: { resolved: game.bus.kind.resolved, healed: game.bus.kind.healed }
    });

    game.bus.handle(game.bus.kind.taken, (event) => {
      if (event.blow?.amount === 30) {
        game.damage.heal({ target: hero, healer: hero, source: 1, amount: 15 });
        game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 5 });
      }
    });
    hero.hp = 50;
    game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 30 });
    assert.deepEqual(linesOf(log), ['0 damage 1>100 30', '0 heal 1>1 15', '0 damage 1>100 5']);
  });

  it('records every blow, immunity, heal, death, aura change, cast moment and area trigger, in order', () => {
    const game = logGame();
    const log = logOf(game);
    const [hero, foe, guard] = [game.unit(1), game.unit(100), game.unit(101)];

    game.spells.cast(hero, game.id.bolt, { input: foe });
    game.auras.apply(guard, game.auraId.shield);
    game.damage.hit({ target: guard, attacker: hero, source: 1, amount: 5 });
    game.damage.heal({ target: foe, healer: hero, source: 1, amount: 50 });
    game.auras.apply(foe, { aura: game.auraId.mark, source: 1 });
    game.areaTriggers.spawn(game.areaId.pool, { owner: hero, at: vec2(0, 0) });
    game.step();
    game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 500 });
    game.auras.tick(foe, 'world');

    assert.deepEqual(linesOf(log), [
      '0 castStart 1>1 0',
      '0 damage 1>100 30',
      '0 castRelease 1>1 0',
      '0 castEnd 1>1 0',
      '0 auraApplied -1>101 1',
      '0 immune 1>101 0',
      '0 heal 1>100 50',
      '0 auraApplied 1>100 1',
      '0 areaSpawned 1>1 0',
      '1 damage 1>100 120',
      '1 death 1>100 0'
    ]);
  });

  it('records a blow before what its triggers set off: a thorns reflect follows the hit', () => {
    const game = logGame();
    const log = logOf(game);
    const [hero, foe] = [game.unit(1), game.unit(100)];

    game.bus.handle(game.bus.kind.taken, (event) => {
      const blow = event.blow;

      if (blow?.target === foe && blow.attacker !== undefined) {
        game.damage.hit({ target: blow.attacker, attacker: foe, source: 100, amount: 3 });
      }
    });

    game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 10 });
    assert.deepEqual(linesOf(log), ['0 damage 1>100 10', '0 damage 100>1 3']);
  });

  it('carries the blow’s numbers, its overkill and flags, and a heal’s', () => {
    const game = logGame();
    const log = logOf(game);
    const [hero, foe] = [game.unit(1), game.unit(100)];
    const entry = log.createEntry();

    game.damage.heal({ target: foe, healer: hero, amount: 10 });
    game.damage.hit({ target: foe, attacker: hero, source: 7, amount: 150 });
    assert.equal(log.read(0, entry), true);
    assert.deepEqual([entry.kind, entry.amount, entry.overflow, entry.base], ['heal', 10, 0, 10]);
    log.read(1, entry);
    assert.deepEqual(
      [entry.kind, entry.source, entry.actor, entry.amount, entry.overflow, entry.base, entry.damageKind],
      ['damage', 7, 1, 110, 40, 150, 0]
    );
    assert.equal(entry.flags & ENTRY_KILLED, ENTRY_KILLED);
    assert.equal(entry.reason, 4);
  });

  it('names the aura a blow or a heal came from, or −1 for none', () => {
    const game = logGame();
    const log = logOf(game);
    const [hero, foe] = [game.unit(1), game.unit(100)];
    const entry = log.createEntry();
    const mark = game.auraId.mark;

    game.damage.hit({ target: foe, attacker: hero, amount: 5, aura: mark });
    game.damage.heal({ target: foe, amount: 5, aura: mark });
    game.damage.hit({ target: foe, amount: 5 });
    log.read(0, entry);
    assert.equal(entry.aura, mark);
    log.read(1, entry);
    assert.equal(entry.aura, mark);
    log.read(2, entry);
    assert.equal(entry.aura, -1);
  });

  it('keeps the latest entries in its ring, and says which it no longer holds', () => {
    const game = logGame();
    const log = logOf(game, 2);
    const foe = game.unit(100);
    const entry = log.createEntry();

    for (const amount of [1, 2, 3]) {
      game.damage.hit({ target: foe, amount });
    }

    assert.deepEqual([log.size, log.total, log.first], [2, 3, 1]);
    assert.equal(log.read(0, entry), false);
    assert.equal(log.read(3, entry), false);
    assert.equal(log.read(2, entry) && entry.amount, 3);
    assert.throws(() => log.read(2, { ...entry }), /log.createEntry/);
  });

  it('checksums its entries, the same for the same run and different for any change', () => {
    const run = (amount: number): string => {
      const game = logGame();
      const log = logOf(game);

      game.damage.hit({ target: game.unit(100), amount });

      return log.checksum();
    };

    assert.equal(run(5), run(5));
    assert.notEqual(run(5), run(6));
    assert.match(run(5), /^[0-9a-f]{8}$/);
  });

  it('checksums every entry ever recorded, overwritten ones too, the same for any capacity, until a clear', () => {
    const run = (amounts: readonly number[], capacity?: number): CombatLog => {
      const game = logGame();
      const log = logOf(game, capacity);

      for (const amount of amounts) {
        game.damage.hit({ target: game.unit(100), amount });
      }

      return log;
    };

    assert.notEqual(run([1, 2, 3], 2).checksum(), run([7, 2, 3], 2).checksum());
    assert.equal(run([1, 2, 3], 2).checksum(), run([1, 2, 3]).checksum());

    const cleared = run([7, 2, 3], 2);

    cleared.clear();
    assert.equal(cleared.checksum(), run([]).checksum());
  });

  it('hands entries to subscribers, forgets them on clear and stops listening on close', () => {
    const game = logGame();
    const log = logOf(game);
    const foe = game.unit(100);
    const seen: string[] = [];
    const off = log.subscribe((entry) => seen.push(`${entry.seq} ${entry.kind}`));

    game.damage.hit({ target: foe, amount: 1 });
    off();
    game.damage.hit({ target: foe, amount: 1 });
    assert.deepEqual(seen, ['0 damage']);
    log.clear();
    assert.deepEqual([log.size, log.total], [0, 0]);
    log.close();
    game.damage.hit({ target: foe, amount: 1 });
    assert.equal(log.total, 0);
  });
});

describe('outcomes in the log', () => {
  it('codes a blow’s outcome row by the roll table’s names', () => {
    const bus = createBus({ taken: (): BlowPayload<number, number> => ({ blow: undefined }) });

    const log = createCombatLog<number, number>({
      bus,
      clock: { tick: 0 },
      idOf: (unit) => unit,
      outcomes: ['miss', 'dodge', 'crit'],
      damage: { taken: bus.kind.taken }
    });

    const blow = {
      target: 2,
      attacker: 1,
      source: 1,
      spell: undefined,
      kind: 0,
      base: 10,
      amount: 0,
      dealt: 0,
      absorbed: 0,
      mitigated: 0,
      status: 'avoided',
      isCrit: false,
      hasKilled: false,
      isDeathPrevented: false,
      outcome: 'dodge'
    };

    const entry = log.createEntry();

    bus.raise(bus.kind.taken, { blow });
    bus.raise(bus.kind.taken, {
      blow: { ...blow, outcome: undefined, status: 'landed', dealt: 10 }
    });
    log.read(0, entry);
    assert.deepEqual([entry.outcome, entry.reason], [1, 5]);
    log.read(1, entry);
    assert.deepEqual([entry.outcome, entry.reason, entry.amount], [-1, 4, 10]);
  });
});

describe('the damage meter', () => {
  it("codes a cast's end and an area trigger's by the game's outcomes and reasons, after the framework's", () => {
    const game = makeSpellGame(
      {
        charge: spell({
          activation: { kind: 'trigger' },
          timeline: { channel: { seconds: 2 } },
          release: () => undefined
        })
      },
      { areaTriggers: { pool: { shape: circle(1), lifetime: 5 } } }
    );

    const { bus } = game;
    const hero = game.unit(1);

    const log = createCombatLog<Game['bearer'], Game['spell']>({
      bus,
      clock: game.clock,
      idOf: (unit) => unit.id,
      spells: { end: bus.kind.spellEnd, outcomes: game.spells.registry.outcomes },
      areaTriggers: { ended: bus.kind.areaEnded, reasons: game.areaTriggers.registry.endReasons }
    });

    const entry = log.createEntry();

    game.spells.finish(game.spells.cast(hero, game.id.charge).handle, 'blocked');
    game.areaTriggers.despawn(game.areaTriggers.spawn(game.areaId.pool, { owner: hero, at: vec2(0, 0) }), 'phase');
    assert.equal(log.read(0, entry) && entry.kind === 'castEnd' ? entry.reason : -1, 3);
    assert.equal(log.read(1, entry) && entry.kind === 'areaEnded' ? entry.reason : -1, 6);
  });

  it('sums damage and healing by credit, and damage taken by target, ranked', () => {
    const game = logGame();
    const log = logOf(game);
    const meter = createDamageMeter(log);
    const [hero, pet, foe] = [game.unit(1), game.unit(2), game.unit(100)];

    game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 20 });
    game.damage.hit({ target: foe, attacker: pet, source: 1, amount: 15 });
    game.damage.hit({ target: hero, attacker: foe, source: 100, amount: 40 });
    game.damage.heal({ target: hero, healer: pet, source: 2, amount: 25 });

    assert.equal(meter.damageBy(1), 35);
    assert.equal(meter.takenBy(100), 35);
    assert.equal(meter.healingBy(2), 25);
    assert.deepEqual(meter.ranking(), [
      { source: 100, damage: 40 },
      { source: 1, damage: 35 }
    ]);
    meter.reset();
    assert.equal(meter.damageBy(1), 0);
    meter.close();
    game.damage.hit({ target: foe, source: 1, amount: 5 });
    assert.equal(meter.damageBy(1), 0);
  });
});
