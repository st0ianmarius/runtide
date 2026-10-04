import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAiSystem } from '../../src/ai/index.ts';
import { auraGates, auraStacks, createAuraSystem } from '../../src/auras/index.ts';
import { createClock } from '../../src/core/index.ts';
import { createDamageSystem, defineDamageKinds } from '../../src/damage/index.ts';
import { createGame } from '../../src/game/index.ts';
import { createModifierSystem, defineSources } from '../../src/modifiers/index.ts';
import { createSpellSystem } from '../../src/spells/index.ts';
import { createUnitSystem, type Unit } from '../../src/units/index.ts';
import {
  AURAS,
  makeTestWorld,
  specOf,
  spellsOf,
  STATES,
  STATS,
  TAGS,
  TEMPLATES,
  type TestGame,
  TIMERS
} from './fixture.ts';

/** Throws: the hand-wired test systems run no procs. */
const noProcs = (): never => {
  throw new Error('No procs in the hand-wired test.');
};

/** What a hand-wired test game leaves out or gets wrong. */
interface HandWiring {
  /** Whether the spell host has `canAct`. */
  readonly canAct: boolean;

  /** Whether the aura host has `onTagsChanged`. */
  readonly onTagsChanged: boolean;

  /** Whether the AI system counts on a clock of its own. */
  readonly ownAiClock?: boolean;
}

/** A hand-wired aura, spell, AI and unit system over the test registries, its hosts as `wiring` says. */
const handWired = (wiring: HandWiring) => {
  const clock = createClock({ dt: 0.25 });
  const late: { units?: ReturnType<typeof createUnitSystem<TestGame>> } = {};

  const auras = createAuraSystem<TestGame>({
    registry: AURAS,
    tags: TAGS,
    clocks: { world: clock },
    states: ['dead', 'despawned'],
    modifiers: createModifierSystem({
      stats: STATS,
      sources: defineSources(['base', 'auras']),
      stacks: auraStacks,
      held: auraGates
    }),
    fold: 'auras',
    host: wiring.onTagsChanged ? { onTagsChanged: (unit: Unit<TestGame>) => late.units?.syncStates(unit) } : {}
  });

  const spells = createSpellSystem<TestGame>({
    registry: spellsOf(true, {}),
    auras,
    procs: noProcs,
    clock,
    host: wiring.canAct ? { canAct: (unit: Unit<TestGame>) => late.units?.canAct(unit) ?? true } : {}
  });

  const ai = createAiSystem<TestGame>({
    spells,
    clock: wiring.ownAiClock === true ? createClock({ dt: 0.25 }) : clock,
    timers: TIMERS
  });

  const units = createUnitSystem<TestGame>({
    registry: TEMPLATES,
    auras,
    spells,
    ai,
    health: { stat: 'maxHealth' },
    states: STATES
  });

  late.units = units;

  return { auras, spells, ai, units };
};

describe('the extended wiring check', () => {
  it('passes a hand-wired game whose hosts carry the units’ gates', () => {
    const { auras, spells, ai, units } = handWired({ canAct: true, onTagsChanged: true });

    units.checkWiring({ spells, auras, ai });
  });

  it('names a spell host without canAct', () => {
    const { auras, spells, units } = handWired({ canAct: false, onTagsChanged: true });

    assert.throws(() => {
      units.checkWiring({ spells, auras });
    }, /wiring, spells.host.canAct:/);
  });

  it('names an aura host without onTagsChanged', () => {
    const { auras, spells, units } = handWired({ canAct: true, onTagsChanged: false });

    assert.throws(() => {
      units.checkWiring({ spells, auras });
    }, /wiring, auras.host.onTagsChanged:/);
  });

  it('names an AI system on another clock than the spells’', () => {
    const { auras, spells, ai, units } = handWired({ canAct: true, onTagsChanged: true, ownAiClock: true });

    assert.throws(() => {
      units.checkWiring({ spells, auras, ai });
    }, /wiring, ai.clock:/);
  });

  it('names a unit state interrupt the spell system does not know, as createGame runs it', () => {
    assert.throws(() => createGame(specOf({ interrupts: false }, {})), /wiring, spells.interrupts: .*stun/);
  });

  it('names a damage host whose health is not the units’, and a damage system over other auras', () => {
    const { game } = makeTestWorld();
    const { spells, auras, ai, procs, units } = game;
    const kinds = defineDamageKinds({ physical: {} });

    const own = createDamageSystem<TestGame>({
      auras,
      kinds,
      host: { ...units.damageHost, health: (unit) => unit.health }
    });

    assert.throws(() => {
      units.checkWiring({ spells, auras, ai, procs, damage: own });
    }, /wiring, damage.host.health:/);

    const other = handWired({ canAct: true, onTagsChanged: true }).auras;
    const elsewhere = createDamageSystem<TestGame>({ auras: other, kinds, host: units.damageHost });

    assert.throws(() => {
      units.checkWiring({ spells, auras, ai, procs, damage: elsewhere });
    }, /wiring, damage.auras:/);
    units.checkWiring({ spells, auras, ai, procs, damage: game.damage });
  });
});
