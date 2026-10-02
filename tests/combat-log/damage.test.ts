import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type BlowPayload,
  type CombatLog,
  createCombatLog,
  createDamageMeter,
  ENTRY_DEATH_PREVENTED,
  ENTRY_KILLED,
  FORCE_KINDS,
  type ForcePayload,
  type ForceView
} from '../../src/combat-log/index.ts';
import { createBus } from '../../src/core/index.ts';
import { createDamageEvent, createForceEvent, type DamageEvent, type ForceEvent } from '../../src/damage/index.ts';
import { aura, type Game, makeDamageGame } from '../helpers/damage-game.ts';

/** The auras of the damage game the log watches: an escape from death and a ward of 10 absorb. */
const AURAS = {
  escape: aura({ duration: 10, onLethal: () => ({ prevent: true, procs: [] }) }),

  ward: aura({
    duration: 10,
    value: 10,
    onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) })
  })
};

/** A damage game and a combat log over its bus. */
const damageLog = (): {
  readonly game: ReturnType<typeof makeDamageGame<keyof typeof AURAS>>;
  readonly log: CombatLog;
} => {
  const game = makeDamageGame(AURAS);

  const log = createCombatLog<Game['bearer'], Game['spell']>({
    bus: game.bus,
    clock: { tick: 0 },
    idOf: (unit) => unit.id,
    damage: { taken: game.bus.kind.taken, healed: game.bus.kind.healed, death: game.bus.kind.death }
  });

  return { game, log };
};

describe('blows in the log', () => {
  it('keeps what a prevented death did not deal in the overflow of a blow flagged death prevented', () => {
    const { game, log } = damageLog();
    const foe = game.unit(100);
    const entry = log.createEntry();

    game.auras.apply(foe, game.id.escape);
    game.damage.hit({ target: foe, amount: 60 });
    game.damage.hit({ target: foe, amount: 70 });
    assert.equal(log.read(1, entry), true);
    assert.deepEqual(
      [entry.kind, entry.amount, entry.overflow, entry.flags & (ENTRY_DEATH_PREVENTED | ENTRY_KILLED)],
      ['damage', 0, 70, ENTRY_DEATH_PREVENTED]
    );
  });
});

describe('the damage meter by spell', () => {
  it('sums the damage dealt per credit and spell, absorbs left out, beside the credit total that counts them', () => {
    const { game, log } = damageLog();
    const meter = createDamageMeter(log);
    const [hero, foe] = [game.unit(1), game.unit(100)];

    game.auras.apply(foe, game.id.ward);
    game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 25, spell: 7 });
    game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 20, spell: 7 });
    game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 30 });

    assert.deepEqual([meter.damageBy(1), meter.damageBySpell(1, 7), meter.damageBySpell(1, -1)], [75, 35, 30]);
    assert.equal(meter.damageBySpell(2, 7), 0);
    assert.deepEqual(meter.spellRanking(1), [
      { spell: 7, damage: 35 },
      { spell: -1, damage: 30 }
    ]);
    meter.reset();
    assert.deepEqual([meter.damageBySpell(1, 7), meter.spellRanking(1)], [0, []]);
  });
});

/** A force as the log reads it, knocked back by a blow of spell 9 from aura 4. */
const FORCE: ForceView<number, number> = {
  target: 2,
  attacker: 1,
  source: 1,
  kind: 'pull',
  base: 10,
  amount: 6,
  blow: { spell: 9, aura: 4 },
  status: 'landed'
};

/** A combat log over a bus that raises forces and blows by hand, with the given force kinds. */
const forceLog = (forceKinds?: readonly string[]) => {
  const bus = createBus({
    forced: (): ForcePayload<number, number> => ({ force: undefined }),
    taken: (): BlowPayload<number, number> => ({ blow: undefined })
  });

  const log = createCombatLog<number, number>({
    bus,
    clock: { tick: 3 },
    idOf: (unit) => unit,
    damage: { forced: bus.kind.forced, taken: bus.kind.taken, ...(forceKinds === undefined ? {} : { forceKinds }) }
  });

  return { bus, log };
};

describe('forces in the log', () => {
  it('records a force: its credit, units, blow spell and aura, strength asked and applied, status and kind', () => {
    const { bus, log } = forceLog();
    const entry = log.createEntry();

    bus.raise(bus.kind.forced, { force: FORCE });
    bus.raise(bus.kind.forced, { force: undefined });
    assert.equal(log.total, 1);
    log.read(0, entry);
    assert.deepEqual(
      [entry.tick, entry.kind, entry.source, entry.actor, entry.target, entry.spell, entry.aura],
      [3, 'force', 1, 1, 2, 9, 4]
    );
    assert.deepEqual(
      [entry.base, entry.amount, entry.reason, entry.forceKind],
      [10, 6, 2, FORCE_KINDS.indexOf('pull')]
    );
    assert.deepEqual([entry.damageKind, entry.overflow, entry.flags], [-1, 0, 0]);
  });

  it('codes a force’s kind by the game’s kinds after the framework’s, −1 for one it was not told of', () => {
    const { bus, log } = forceLog([...FORCE_KINDS, 'launch']);
    const entry = log.createEntry();

    bus.raise(bus.kind.forced, { force: { ...FORCE, kind: 'launch', status: 'ignored', amount: 0, blow: undefined } });
    bus.raise(bus.kind.forced, { force: { ...FORCE, kind: 'yank' } });
    log.read(0, entry);
    assert.deepEqual([entry.forceKind, entry.reason, entry.amount, entry.spell, entry.aura], [3, 1, 0, -1, -1]);
    log.read(1, entry);
    assert.equal(entry.forceKind, -1);
  });

  it('leaves a force out of the meter, and a force’s column out of a blow', () => {
    const { bus, log } = forceLog();
    const meter = createDamageMeter(log);
    const entry = log.createEntry();

    bus.raise(bus.kind.forced, { force: FORCE });
    bus.raise(bus.kind.taken, {
      blow: {
        target: 2,
        attacker: 1,
        source: 1,
        spell: 9,
        kind: 0,
        base: 5,
        amount: 5,
        dealt: 5,
        absorbed: 0,
        mitigated: 0,
        status: 'landed',
        isCrit: false,
        hasKilled: false,
        isDeathPrevented: false,
        outcome: undefined
      }
    });
    assert.deepEqual([meter.damageBy(1), meter.damageBySpell(1, 9)], [5, 5]);
    log.read(1, entry);
    assert.deepEqual([entry.kind, entry.forceKind], ['damage', -1]);
  });
});

describe('forces from the damage system', () => {
  it('records each force the damage system raises `forced` for, with the spell of the blow behind it', () => {
    const bus = createBus({
      taken: (): DamageEvent<Game> => createDamageEvent<Game>(),
      forced: (): ForceEvent<Game> => createForceEvent<Game>()
    });

    const game = makeDamageGame(AURAS, { events: { bus, taken: bus.kind.taken, forced: bus.kind.forced } });

    const log = createCombatLog<Game['bearer'], Game['spell']>({
      bus,
      clock: { tick: 0 },
      idOf: (unit) => unit.id,
      damage: { taken: bus.kind.taken, forced: bus.kind.forced }
    });

    const [hero, foe] = [game.unit(1), game.unit(100)];
    const entry = log.createEntry();
    const blow = game.damage.hit({ target: foe, attacker: hero, source: 1, amount: 5, spell: 7 });

    game.damage.force({ target: foe, attacker: hero, strength: 4, kind: 'push', blow });
    game.damage.force({ target: foe, strength: 0 });
    assert.equal(log.total, 2);
    log.read(1, entry);
    assert.deepEqual(
      [entry.kind, entry.source, entry.actor, entry.target, entry.spell, entry.base, entry.amount, entry.reason],
      ['force', 1, 1, 100, 7, 4, 4, 2]
    );
    assert.equal(entry.forceKind, FORCE_KINDS.indexOf('push'));
  });
});
