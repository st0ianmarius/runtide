import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AuraBearer, createAuraSystem, defineAura, defineAuras, defineAuraTags } from '../../src/auras/index.ts';
import { defineCountdown, MOTION_COUNTDOWN, stepsUntil, WORLD_COUNTDOWN } from '../../src/core/index.ts';
import { aura, makeGame } from '../helpers/aura-game.ts';

const defs = {
  haste: aura({ duration: 0.5, clock: 'motion' }),
  shield: aura({ duration: 2 }),
  forever: aura({ duration: 'infinite' }),
  flash: aura({ duration: 0 }),
  cooldown: aura({}),
  scaled: aura({ duration: (bearer) => bearer.hp / 50 }),
  fading: aura({ duration: 'infinite', value: 3, expiresWhen: (ctx) => ctx.aura.value <= 0 }),
};

/** A one-aura system on a 1/60 s clock with the given countdown rule, and a bearer. */
const sixtyHertz = (countdown: typeof WORLD_COUNTDOWN, seconds: number) => {
  const registry = defineAuras({ timed: defineAura({ duration: seconds }) });

  const auras = createAuraSystem({
    registry,
    tags: defineAuraTags([]),
    clocks: { world: { dt: 1 / 60, countdown } },
  });

  const bearer: AuraBearer = { auras: auras.createState() };

  return { auras, bearer, id: registry.id.timed };
};

describe('clocks and stamps', () => {
  it('each clock counts only its own auras; a bearer counts its own steps', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();
    const other = unit(2);

    auras.apply(u, id.haste);
    auras.apply(u, id.shield);
    auras.apply(other, id.shield);
    run(u, 10);
    assert.equal(auras.remaining(u, id.haste), 0.5, 'the motion aura waits for motion steps');
    assert.equal(auras.remaining(u, id.shield), 0.75);
    assert.equal(auras.remaining(other, id.shield), 2, 'the other bearer took no steps');
    assert.deepEqual(Array.from(u.auras.clocks), [10, 0]);
    run(u, 3, 'motion');
    assert.equal(auras.has(u, id.haste), true);
    run(u, 1, 'motion');
    assert.equal(auras.has(u, id.haste), false, 'gone on the fourth motion step');
  });

  it('stamps an aura on the tick a countdown under its clock rule runs out', () => {
    for (const countdown of [WORLD_COUNTDOWN, MOTION_COUNTDOWN, defineCountdown({ snap: false, epsilon: 1e-6 })]) {
      for (const seconds of [0.25, 0.5, 1, 1.08, 1.17, 2, 4.5, 12, 1 / 60]) {
        const { auras, bearer, id } = sixtyHertz(countdown, seconds);
        const steps = stepsUntil(seconds, 1 / 60, countdown);

        auras.apply(bearer, id);
        assert.equal(auras.find(bearer, id)?.end, steps, `${seconds} s`);

        for (let i = 1; i < steps; i++) {
          auras.tick(bearer, 'world');
        }

        assert.equal(auras.has(bearer, id), true, `${seconds} s, one tick before`);
        auras.tick(bearer, 'world');
        assert.equal(auras.has(bearer, id), false, `${seconds} s, on its tick`);
      }
    }
  });

  it('lets the clock rule decide a float a plain countdown leaves a sliver of', () => {
    const plain = sixtyHertz(WORLD_COUNTDOWN, 3);
    const snapped = sixtyHertz(MOTION_COUNTDOWN, 3);

    plain.auras.apply(plain.bearer, plain.id);
    snapped.auras.apply(snapped.bearer, snapped.id);
    assert.equal(plain.auras.find(plain.bearer, plain.id)?.end, 181, 'max(0, t − dt) leaves a sliver for one tick');
    assert.equal(snapped.auras.find(snapped.bearer, snapped.id)?.end, 180, 'a snap within 1e-8 does not');
  });

  it('never runs an infinite aura out; it leaves only when removed', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.forever);
    run(u, 10_000);
    assert.equal(auras.remaining(u, id.forever), Infinity);
    assert.equal(auras.find(u, id.forever)?.end, Infinity);
    assert.equal(auras.remove(u, id.forever), true);
    assert.equal(auras.remove(u, id.forever), false);
  });

  it('runs a zero-length aura out on its next tick', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.flash);
    assert.equal(auras.has(u, id.flash), true);
    run(u, 1);
    assert.equal(auras.has(u, id.flash), false);
  });

  it('refuses an aura with no length of its own unless the application gives one', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    assert.throws(() => auras.apply(u, id.cooldown), /no length of its own/);
    assert.equal(auras.apply(u, { aura: id.cooldown, duration: 3 }).applied, true);
    assert.throws(() => auras.apply(u, { aura: id.cooldown, duration: -1 }), /seconds from 0/);
  });

  it('reads a length function at every application', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    assert.equal(auras.lengthOf(id.scaled, u), 2);
    auras.apply(u, id.scaled);
    assert.equal(auras.remaining(u, id.scaled), 2);
    u.hp = 200;
    auras.apply(u, id.scaled);
    assert.equal(auras.remaining(u, id.scaled), 4);
  });

  it("ends an aura by its own rule on a tick of its clock (a game's own expiry)", () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.fading);
    auras.spendValue(u, id.fading, 1);
    run(u, 1);
    assert.equal(auras.has(u, id.fading), true);
    auras.spendValue(u, id.fading, 2);
    assert.equal(auras.has(u, id.fading), false, 'spent to 0 without keepWhenDepleted, it is removed at once');
  });

  it('tests the expiry rule only on ticks of its own clock', () => {
    const { auras, id, unit, run } = makeGame({
      held: aura({ duration: 'infinite', clock: 'motion', expiresWhen: () => true }),
    });

    const u = unit();

    auras.apply(u, id.held);
    run(u, 3);
    assert.equal(u.auras.list.length, 1);
    run(u, 1, 'motion');
    assert.equal(u.auras.list.length, 0);
  });

  it('sets the clock again with refresh, to a length or the aura own', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.shield);
    run(u, 8);
    assert.equal(auras.refresh(u, id.shield), true);
    assert.equal(auras.remaining(u, id.shield), 2);
    assert.equal(auras.refresh(u, id.shield, 0.5), true);
    assert.equal(auras.remaining(u, id.shield), 0.5);
    assert.equal(auras.refresh(u, id.haste), false);
  });
});
