import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineTickSlots } from '../../src/core/index.ts';
import { createCueBuffer, defineCue, defineCues } from '../../src/cues/index.ts';
import {
  applyAura,
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  cue,
  defineProcKind,
  escapeReport,
  grant,
  group,
  raise,
  removeByTag,
  timeLeft
} from '../../src/procs/index.ts';
import {
  aura,
  type Game,
  type HitEvent,
  invalid,
  KINDS,
  makeGame,
  mark,
  STRIKE,
  type StrikeProc,
  TAGS
} from '../helpers/trigger-game.ts';

const defs = {
  ward: aura({ duration: 4, tags: ['magic'] }),
  swarm: aura({ duration: 4, stacking: 'independent' })
};

/** A cue table with a predicted cast cue beside a plain one. */
const CUES = defineCues({
  swing: defineCue({ anchor: 'self', isPredicted: true }),
  flash: defineCue({ anchor: 'target' })
});

describe('procs.prepare refuses at load', () => {
  it('a string target the runner does not know, on any targeted kind and on a cue', () => {
    const { procs } = makeGame(defs, { procs: { cues: createCueBuffer(CUES) } });

    assert.throws(
      () => procs.prepare([invalid(applyAura<Game>('ward'), { to: 'tagret' })], 'Ward list'),
      /^RangeError: Ward list: unknown target tagret/
    );
    assert.throws(
      () => procs.prepare([group<Game>([invalid(grant<Game>('gold', 1), { to: 'Self' })])], 'Gold list'),
      /Gold list: unknown target Self/
    );
    assert.throws(() => procs.prepare([invalid(cue<Game>('flash'), { to: 'foe' })], 'Cues'), /unknown target foe/);
    assert.equal(procs.prepare([applyAura<Game>('ward', { to: 'other' })], 'Fine').length, 1);
  });

  it('an applyAura with an unknown stacking rule, a rule on an independent aura, or a bad length or stack count', () => {
    const { procs } = makeGame(defs);

    const refuse = (patch: Readonly<Record<string, unknown>>, name: 'ward' | 'swarm', message: RegExp): void => {
      assert.throws(() => procs.prepare([invalid(applyAura<Game>(name), patch)], 'Auras'), message);
    };

    refuse({ stacking: 'stak' }, 'ward', /Auras: unknown stacking rule stak/);
    refuse({ stacking: 'independent' }, 'ward', /unknown stacking rule independent/);
    refuse({ stacking: 'refresh' }, 'swarm', /Auras: an applyAura cannot pick a stacking rule for an independent/);
    refuse({ duration: Number.NaN }, 'ward', /duration must be a number from 0; got NaN/);
    refuse({ duration: -1 }, 'ward', /duration must be a number from 0; got -1/);
    refuse({ stacks: -1 }, 'ward', /stacks must be a finite number from 0; got -1/);
    refuse({ stacks: Infinity }, 'ward', /stacks must be a finite number from 0; got Infinity/);
    assert.equal(
      procs.prepare([applyAura<Game>('ward', { stacking: 'extend', duration: 0, stacks: 2 })], 'A').length,
      1
    );
    assert.equal(procs.prepare([applyAura<Game>('ward', { duration: Infinity })], 'Stays').length, 1);
  });

  it('a tag id outside the tag table, a resource id that is not one, and a grant amount that is not finite', () => {
    const { procs } = makeGame(defs);

    assert.throws(
      () => procs.prepare([invalid(removeByTag<Game>('magic'), { tag: 99 })], 'Cleanse'),
      /Cleanse: 99 is not a tag id/
    );
    assert.throws(
      () => procs.prepare([invalid(timeLeft<Game>('magic', { factor: 0 }), { tag: -1 })], 'Cd'),
      /-1 is not a tag id/
    );
    assert.throws(() => procs.prepare([grant<Game>(2, 1)], 'Gold'), /Gold: unknown resource 2/);
    assert.throws(() => procs.prepare([grant<Game>(0.5, 1)], 'Gold'), /unknown resource 0.5/);
    assert.throws(() => procs.prepare([grant<Game>('gold', Number.NaN)], 'Gold'), /amount must be a finite number/);
    assert.equal(procs.prepare([removeByTag<Game>(TAGS.id.cooldown), grant<Game>(1, -3)], 'Fine').length, 2);
  });

  it('a timeLeft with neither a factor nor a max, or a factor that is not finite', () => {
    const { procs } = makeGame(defs);

    assert.throws(() => procs.prepare([timeLeft<Game>('cooldown')], 'Cd'), /takes a factor, a max or both/);
    assert.throws(
      () => procs.prepare([timeLeft<Game>('cooldown', { factor: Infinity })], 'Cd'),
      /takes a finite factor from 0/
    );
    assert.equal(procs.prepare([timeLeft<Game>('cooldown', { max: 2 })], 'Cd').length, 1);
  });

  it('a proc whose service is missing: grant, a rolled chance, an event, a party target or a party cue', () => {
    const game = makeGame(defs);

    const bare = createProcSystem<Game>({
      kinds: game.procs.kinds,
      auras: game.auras,
      host: { log: [] },
      cues: createCueBuffer(CUES)
    });

    assert.throws(() => bare.prepare([grant<Game>('gold', 1)], 'Loot'), /Loot: a grant proc needs .* grant service/);
    assert.throws(() => bare.prepare([mark('a', 0.5)], 'Odds'), /Odds: a chance of 0.5 needs .* random stream/);
    assert.throws(() => bare.prepare([raise<HitEvent, Game>(KINDS.hit, () => undefined)], 'Ev'), /Ev: an event .* bus/);
    assert.throws(() => bare.prepare([applyAura<Game>('ward', { to: 'party' })], 'P'), /P: a party target needs/);
    assert.throws(() => bare.prepare([cue<Game>('flash', { to: 'party' })], 'C'), /C: a party target needs/);
    assert.equal(bare.prepare([mark('a'), mark('b', 1)], 'Always').length, 2);

    const rolled = makeGame(defs, { procs: { rollChance: () => true } });

    assert.equal(rolled.procs.prepare([mark('a', 0.5)], 'Odds').length, 1);
  });

  it('a predicted cue, which its cast fires with a press key a proc does not have', () => {
    const { procs } = makeGame(defs, { procs: { cues: createCueBuffer(CUES) } });

    assert.throws(
      () => procs.prepare([cue<Game>('swing')], 'Cast cues'),
      /Cast cues: cue swing is predicted: a predicted cue is fired by its cast, not by a proc/
    );
    assert.equal(procs.prepare([cue<Game>('flash')], 'Cues').length, 1);
  });

  it('prefixes the list name even when the message starts with it', () => {
    const { procs } = makeGame(defs);

    assert.throws(() => procs.prepare([timeLeft<Game>('cooldown')], 'A'), /^RangeError: A: A timeLeft proc/);
  });
});

describe('createProcRegistry refuses a kind the runner could not dispatch', () => {
  it('an optional member that is not a function, and a follow without a targetOf', () => {
    const follow = () => undefined;
    const untargeted = defineProcKind<StrikeProc, Game>({ apply: () => undefined, follow });

    assert.throws(
      () => createProcRegistry<Game>({ ...CORE_PROCS, strike: invalid(STRIKE, { prepare: 'yes' }) }),
      /Proc kind strike: its prepare must be a function/
    );
    assert.throws(
      () => createProcRegistry<Game>({ ...CORE_PROCS, strike: invalid(STRIKE, { targetOf: undefined }) }),
      /its targetOf must be a function/
    );
    assert.throws(
      () => createProcRegistry<Game>({ ...CORE_PROCS, strike: untargeted }),
      /Proc kind strike has a follow but no targetOf/
    );
    assert.equal(createProcRegistry<Game>({ ...CORE_PROCS, strike: { ...STRIKE, follow } }).names.length, 12);
  });
});

describe('the escape report’s slots', () => {
  it('lists the tick slots it is given, in id order, and none without them', () => {
    const { procs } = makeGame(defs);

    assert.deepEqual(escapeReport({ procs, tickSlots: defineTickSlots(['movement', 'attack']) }).slots, [
      'movement',
      'attack'
    ]);
    assert.deepEqual(escapeReport({ procs }).slots, []);
  });
});
