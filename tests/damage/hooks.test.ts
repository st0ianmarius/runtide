import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { heal, setHealth } from '../../src/damage/index.ts';
import { aura, KINDS, makeDamageGame } from '../helpers/damage-game.ts';

/** The test auras: an immunity to all but fire, two absorbs, a damage-taken scale, a knock veto, a death escape, a leech. */
const AURAS = {
  invulnerable: aura({ duration: 'infinite', onIgnore: (_ctx, blow) => blow.kind !== KINDS.id.fire }),

  barrier: aura({
    duration: 10,
    value: 30,
    keepWhenDepleted: true,
    onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) }),
  }),

  ward: aura({
    duration: 10,
    value: 20,
    onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) }),
  }),
  halve: aura({ duration: 10, onIncomingDamage: () => ({ scale: 0.5 }) }),
  steady: aura({ duration: 10, onIncomingDamage: () => ({ knock: 'none' }) }),
  escape: aura({ duration: 10, onLethal: () => ({ prevent: true, procs: [setHealth({ share: 0.3 })] }) }),
  leech: aura({ duration: 10, onDealt: (_ctx, blow) => [heal(blow.dealt / 2)] }),
  executioner: aura({
    duration: 10,
    onOutgoingDamage: (_ctx, blow) => (blow.target.hp < 50 ? { scale: 2 } : undefined),
  }),
} as const;

describe('the outgoing hook (onOutgoingDamage)', () => {
  it("changes the blows its bearer deals, reading the target, before the target's own stages", () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const [target, attacker] = [unit(1), unit(2)];

    auras.apply(attacker, id.executioner);
    auras.apply(target, id.halve);
    damage.hit({ target, attacker, amount: 20 });
    assert.equal(target.hp, 90);
    target.hp = 40;
    assert.equal(damage.hit({ target, attacker, amount: 20 }).amount, 20);
    assert.equal(damage.hit({ target, amount: 20 }).amount, 10);
  });
});

describe('the ignore stage (onIgnore)', () => {
  it('lets a blow pass its target by: health, events and every later blow stage untouched', () => {
    const { damage, auras, id, unit, bus, log } = makeDamageGame(AURAS);
    const target = unit(1);

    bus.on(bus.kind.taken, (event) => log.push(`taken ${event.blow?.status}`));
    auras.apply(target, id.invulnerable);

    const blow = damage.hit({ target, amount: 30 });

    assert.deepEqual([blow.status, blow.amount, target.hp], ['ignored', 0, 100]);
    assert.deepEqual(log, []);
  });

  it('is written by the hook against the blow: a kind only its own immunity stops passes', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.invulnerable);

    assert.equal(damage.hit({ target, amount: 30, kind: damage.kinds.id.fire }).status, 'landed');
    assert.equal(target.hp, 70);
  });

  it('still lets an ignored blow’s knockback through the force pipeline', () => {
    const { damage, auras, id, unit, log } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.invulnerable);
    damage.hit({ target, amount: 30, knock: 3 });
    assert.deepEqual(log, ['force knock 3@1']);
  });
});

describe('absorbs (onIncomingDamage)', () => {
  it('take their amount out of the blow and spend the aura’s value by as much', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.barrier);

    const blow = damage.hit({ target, amount: 50 });

    assert.deepEqual([blow.status, blow.absorbed, blow.amount, target.hp], ['landed', 30, 20, 80]);
    assert.equal(auras.find(target, id.barrier)?.value, 0);
  });

  it('end a blow they ate whole `absorbed`, with nothing taken from health', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.barrier);

    const blow = damage.hit({ target, amount: 10 });

    assert.deepEqual([blow.status, blow.amount, blow.absorbed, target.hp], ['absorbed', 0, 10, 100]);
    assert.equal(auras.find(target, id.barrier)?.value, 20);
  });

  it('are spent one after another in registry order, and a depleted one goes unless it keeps', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.ward);
    auras.apply(target, id.barrier);
    damage.hit({ target, amount: 45 });

    assert.equal(auras.find(target, id.barrier)?.value, 0);
    assert.equal(auras.find(target, id.ward)?.value, 5);
    damage.hit({ target, amount: 10 });
    assert.equal(auras.has(target, id.ward), false);
    assert.equal(auras.has(target, id.barrier), true);
    assert.equal(target.hp, 95);
  });

  it('scale what is left, and may cancel the blow’s knockback', () => {
    const { damage, auras, id, unit, log } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.halve);
    auras.apply(target, id.steady);

    const blow = damage.hit({ target, amount: 30, knock: 2 });

    assert.deepEqual([blow.amount, blow.isKnockCancelled, target.hp], [15, true, 85]);
    assert.deepEqual(log, []);
  });

  it('are skipped by true damage, which keeps every point', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.barrier);
    damage.hit({ target, amount: 25, kind: damage.kinds.id.pure });
    assert.equal(target.hp, 75);
    assert.equal(auras.find(target, id.barrier)?.value, 30);
  });
});

describe('the lethal stage (onLethal)', () => {
  it('runs only for a blow that would kill, and a prevented death keeps the damage back and runs the hook’s procs', () => {
    const { damage, auras, id, unit, log } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.escape);
    damage.hit({ target, amount: 50 });
    assert.equal(target.hp, 50);

    const blow = damage.hit({ target, amount: 60 });

    assert.deepEqual(
      [blow.status, blow.isDeathPrevented, blow.prevented, blow.amount, blow.hasKilled],
      ['landed', true, 60, 0, false],
    );
    assert.equal(target.hp, 30);
    assert.deepEqual(log, []);
  });

  it('runs for true damage too', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.escape);

    assert.equal(damage.hit({ target, amount: 500, kind: damage.kinds.id.pure }).isDeathPrevented, true);
    assert.equal(target.hp, 30);
  });
});

describe('the attacker’s onDealt hooks (§II.6 D2)', () => {
  it('run after health for a blow that was dealt, their procs credited to the aura', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const [target, attacker] = [unit(1), unit(2)];

    attacker.hp = 50;
    auras.apply(attacker, id.leech);
    damage.hit({ target, attacker, amount: 30 });
    assert.equal(attacker.hp, 65);

    auras.apply(target, id.invulnerable);
    damage.hit({ target, attacker, amount: 30 });
    assert.equal(attacker.hp, 65);
  });
});
