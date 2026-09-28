import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCueBuffer, type CueBuffer, defineCue, defineCues, fireCue, NO_ENTITY } from '../../src/cues/index.ts';
import type { Blow, DamageCues, Death, Force, Heal } from '../../src/damage/index.ts';
import { aura, type Game, makeDamageGame } from '../helpers/damage-game.ts';

/** A neutral cue table: numbers for what landed and what was absorbed, a callout for what was ignored, a death flash. */
const CUES = defineCues({
  number: defineCue({ anchor: 'entity', params: { amount: { kind: 'int' }, isCrit: { kind: 'uint8' } } }),
  soaked: defineCue({ anchor: 'entity', audience: 'owner', params: { amount: { kind: 'int' } } }),
  callout: defineCue({ anchor: 'entity', params: { reason: { kind: 'uint8' } } }),
  mended: defineCue({ anchor: 'entity', params: { amount: { kind: 'int' } } }),
  shoved: defineCue({ anchor: 'entity', params: { strength: { kind: 'fixed', scale: 100 } } }),
  fell: defineCue({ anchor: 'entity' }),
});

/** Auras the tests hook the pipelines with: an immunity, an absorb, and one that notes its bearer's death. */
const AURAS = {
  immune: aura({ duration: 'infinite', onIgnore: () => true }),
  ward: aura({ duration: 'infinite', value: 10, onIncomingDamage: (ctx) => ({ absorb: ctx.aura.value }) }),

  doomed: aura({
    duration: 'infinite',

    onBearerDeath: () => {
      LOG.push('aura hears the death');

      return undefined;
    },
  }),
} as const;

/** What the mappings and listeners saw, in order; cleared by each game. */
const LOG: string[] = [];

/** Places a cue on a unit: the unit's own, at its id along x. */
const on = (unit: { readonly id: number }, owner = unit.id) => ({ owner, entity: unit.id, x: unit.id, z: 0 });

/** The game's mapping, written as a game would: which outcomes show, and with which numbers. */
const MAPPING: Omit<DamageCues<Game>, 'out'> = {
  blow: (blow: Blow<Game>, out: CueBuffer) => {
    LOG.push(`blow cues (${blow.status})`);

    if (blow.status === 'ignored') {
      fireCue(out, { cue: CUES.id.callout, params: { reason: 1 } }, on(blow.target));
    }

    if (blow.absorbed > 0) {
      fireCue(out, { cue: CUES.id.soaked, params: { amount: blow.absorbed } }, on(blow.target));
    }

    if (blow.dealt > 0) {
      const owner = blow.attacker?.id ?? NO_ENTITY;

      fireCue(
        out,
        { cue: CUES.id.number, params: { amount: blow.dealt, isCrit: blow.isCrit ? 1 : 0 } },
        on(blow.target, owner),
      );
    }
  },

  heal: (heal: Heal<Game>, out: CueBuffer) => {
    LOG.push(`heal cues (${heal.status})`);
    fireCue(out, { cue: CUES.id.mended, params: { amount: heal.amount } }, on(heal.target));
  },

  force: (force: Force<Game>, out: CueBuffer) => {
    LOG.push(`force cues (${force.status})`);
    fireCue(out, { cue: CUES.id.shoved, params: { strength: force.amount } }, on(force.target));
  },

  death: (death: Death<Game>, out: CueBuffer) => {
    LOG.push('death cues');
    fireCue(out, { cue: CUES.id.fell }, on(death.unit, death.killer?.id));
  },
};

/** A damage game whose pipelines fire the mapping's cues, with its events logged too. */
const makeCueGame = (mapping: Omit<DamageCues<Game>, 'out'> = MAPPING) => {
  const out = createCueBuffer(CUES);
  const game = makeDamageGame(AURAS, { cues: { out, ...mapping } });
  const { bus } = game;

  LOG.length = 0;
  bus.on(bus.kind.taken, () => LOG.push('taken event'));
  bus.on(bus.kind.healed, () => LOG.push('healed event'));
  bus.on(bus.kind.death, () => LOG.push('death event'));

  /** The events fired so far: cue name, owner, entity and the first param. */
  const fired = () =>
    out.events.slice(0, out.count).map((event) => [CUES.name(event.cue), event.owner, event.entity, event.values[0]]);

  return { ...game, out, fired };
};

describe('damage cues (§I.5.3, §II.3.9)', () => {
  it("fires a blow's cues in the outcome stage, before its events, from what the game maps", () => {
    const { damage, unit, auras, id, fired } = makeCueGame();
    const target = unit(1);

    auras.apply(target, id.ward);
    damage.hit({ target, amount: 30, attacker: unit(2) });

    assert.deepEqual(LOG, ['blow cues (landed)', 'taken event']);
    assert.deepEqual(fired(), [
      ['soaked', 1, 1, 10],
      ['number', 2, 1, 20],
    ]);
  });

  it('maps an ignored blow too, and never a skipped one', () => {
    const { damage, unit, auras, id, fired } = makeCueGame();
    const target = unit(1);

    damage.hit({ target, amount: 0 });
    auras.apply(target, id.immune);
    damage.hit({ target, amount: 30 });

    assert.deepEqual(LOG, ['blow cues (ignored)']);
    assert.deepEqual(fired(), [['callout', 1, 1, 1]]);
  });

  it("fires a heal's cues before its event, and a force's after its stages", () => {
    const { damage, unit, fired } = makeCueGame();
    const target = unit(1);

    target.hp = 50;
    damage.heal({ target, amount: 20 });
    damage.force({ target, strength: 1.5, kind: 'push', direction: { x: 1, z: 0 } });

    assert.deepEqual(LOG, ['heal cues (landed)', 'healed event', 'force cues (landed)']);
    assert.deepEqual(fired(), [
      ['mended', 1, 1, 20],
      ['shoved', 1, 1, 1.5],
    ]);
  });

  it("fires a death's cues first in the death pipeline, before the dead unit's auras hear it", () => {
    const { damage, unit, auras, id, fired } = makeCueGame();
    const target = unit(1);

    auras.apply(target, id.doomed);
    damage.hit({ target, amount: 500, attacker: unit(2) });

    assert.deepEqual(LOG, ['blow cues (landed)', 'taken event', 'death cues', 'aura hears the death', 'death event']);
    assert.deepEqual(fired(), [
      ['number', 2, 1, 100],
      ['fell', 2, 1, 0],
    ]);
  });

  it('fires nothing for an outcome the game maps nothing to', () => {
    const { damage, unit, fired } = makeCueGame({ death: MAPPING.death ?? (() => undefined) });

    damage.hit({ target: unit(1), amount: 30 });
    damage.heal({ target: unit(2), amount: 5 });

    assert.deepEqual(fired(), []);
    assert.deepEqual(LOG, ['taken event', 'healed event']);
  });
});
