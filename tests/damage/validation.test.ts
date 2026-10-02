import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDamageSystem,
  damage,
  type DamageHost,
  type DamageKindDef,
  defineDamageKinds
} from '../../src/damage/index.ts';
import type { RollEffect } from '../../src/damage/rolls.ts';
import { aura, BLOCK, type Game, KINDS, makeDamageGame } from '../helpers/damage-game.ts';

/** A host with health alone. */
const BARE_HOST: DamageHost<Game> = {
  health: (unit) => unit.hp,

  setHealth: (unit, hp) => {
    unit.hp = hp;
  }
};

describe('the host check at build', () => {
  it('refuses a host without run when an aura has a damage hook that returns procs', () => {
    const { auras } = makeDamageGame({ leech: aura({ duration: 5, onDealt: () => undefined }) });

    assert.throws(() => createDamageSystem<Game>({ auras, kinds: KINDS, host: BARE_HOST }), /host\.run/);
  });

  it('refuses a host without applyForce when the game uses forces', () => {
    const { auras } = makeDamageGame({ heavy: aura({ duration: 5, onIncomingForce: () => ({ scale: 0.5 }) }) });
    const plain = makeDamageGame({}).auras;

    assert.throws(() => createDamageSystem<Game>({ auras, kinds: KINDS, host: BARE_HOST }), /applyForce/);
    assert.throws(
      () =>
        createDamageSystem<Game>({
          auras: plain,
          kinds: KINDS,
          host: BARE_HOST,
          forceStages: { cap: { before: 'apply', run: () => undefined } }
        }),
      /applyForce/
    );
  });

  it('refuses it for an absorb hook too, and builds a game with neither from health alone', () => {
    const { auras } = makeDamageGame({ armored: aura({ duration: 5, onIncomingDamage: () => undefined }) });

    assert.throws(() => createDamageSystem<Game>({ auras, kinds: KINDS, host: BARE_HOST }), /host\.run/);
    assert.doesNotThrow(() =>
      createDamageSystem<Game>({ auras: makeDamageGame({}).auras, kinds: KINDS, host: BARE_HOST })
    );
  });
});

describe('a damage proc’s skips and bypass', () => {
  it('are checked at load: a skips name that is not an outcome row, a bypass that is not a stage before health', () => {
    const { procs } = makeDamageGame({}, { rolls: BLOCK });

    assert.throws(() => procs.prepare([damage<Game>(5, { skips: ['blok'] })], 'a typo'), /Damage system: .*blok/);
    assert.throws(
      () => procs.prepare([damage<Game>(5, { bypass: ['health'] })], 'too late'),
      /Damage system: .*health/
    );
    assert.throws(() => procs.prepare([damage<Game>(5, { bypass: ['armour'] })], 'a typo'), /armour/);
    assert.doesNotThrow(() => procs.prepare([damage<Game>(5, { skips: ['block'], bypass: ['mitigation'] })], 'fine'));
  });

  it('refuses every skips name when the game has no roll table', () => {
    const { procs } = makeDamageGame({});

    assert.throws(() => procs.prepare([damage<Game>(5, { skips: ['block'] })], 'no rows'), /no rows/);
  });
});

describe('a kind’s unrolled effects', () => {
  it('are checked at build, so a typo does not roll the row anyway', () => {
    const { auras } = makeDamageGame({});
    // A typo, as data loaded from a file would carry it past the type.
    const typo = ['blok'].filter((name): name is RollEffect => name.length > 0);
    const kind: DamageKindDef = { unrolled: typo };
    const kinds = defineDamageKinds({ physical: kind, fire: {}, pure: {} });

    assert.throws(
      () => createDamageSystem<Game>({ auras, kinds, host: BARE_HOST }),
      /Damage system: damage kind physical cannot leave blok unrolled/
    );
  });
});
