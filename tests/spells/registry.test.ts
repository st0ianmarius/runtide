import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOMBSTONE } from '../../src/core/index.ts';
import { add, ranks, scaled } from '../../src/modifiers/index.ts';
import {
  type ActivationShape,
  type AnySpellDef,
  CORE_ACTIVATIONS,
  defineActivationKind,
  defineActivations,
  defineSpell,
  defineSpells,
  lockAtShare,
  lockAtStart,
  lockBefore,
  type SpellRegistryOptions,
  type TrackContext,
} from '../../src/spells/index.ts';
import { type Game, spell, SPELL_TAGS, STATS } from '../helpers/spell-game.ts';

/** A spell that does nothing when it goes out. */
const release = (): undefined => undefined;

/** Three neutral spells: an auto swing, an ai slam with a windup, a trigger nova with a table of stats. */
const SPELLS = () =>
  defineSpells<Game, 'swing' | 'slam' | 'retired' | 'nova'>(
    {
      swing: spell({ activation: { kind: 'auto', interval: 1.5 }, tags: ['melee'], release }),
      slam: spell({
        activation: { kind: 'ai', windup: 1.2, lock: 0.3, recover: 0.5 },
        tags: ['area', 'melee'],
        target: (ctx) => ctx.input,
        release,
      }),
      retired: TOMBSTONE,
      nova: spell({
        activation: { kind: 'trigger' },
        ranks: 3,
        live: true,
        stats: { damage: scaled(ranks(10, 20, 30), add('power', 0.5)), radius: 4 },
        scaling: { damage: 1.1 },
        timeline: { channel: { seconds: 2, every: 0.5, tick: () => undefined } },
        release,
        onHit: () => undefined,
      }),
    },
    { tags: SPELL_TAGS, stats: STATS },
  );

describe('the spell registry', () => {
  it('gives each spell its id by key order, a retired slot kept as a tombstone', () => {
    const registry = SPELLS();

    assert.deepEqual(registry.id, { swing: 0, slam: 1, retired: 2, nova: 3 });
    assert.deepEqual(registry.ids, [0, 1, 3]);
    assert.equal(registry.isRetired(registry.id.retired), true);
    assert.throws(() => registry.get(registry.id.retired), RangeError);
    assert.equal(registry.kind, 'spells');
  });

  it("builds typed columns: activation kind, ranks, flags and each stage's constant seconds", () => {
    const { columns } = SPELLS();

    assert.deepEqual([...columns.activation], [0, 4, 0, 3]);
    assert.deepEqual([...columns.ranks], [1, 1, 0, 3]);
    assert.deepEqual([...columns.flags], [0, 0, 0, 3]);
    assert.deepEqual([...columns.windup], [0, 1.2, 0, 0]);
    assert.deepEqual([...columns.channel], [0, 0, 0, 2]);
    assert.deepEqual([...columns.every], [0, 0, 0, 0.5]);
    assert.deepEqual([...columns.recover], [0, 0.5, 0, 0]);
    assert.ok(columns.windup instanceof Float64Array);
  });

  it('reads a stage whose seconds are a function as NaN in its column', () => {
    const registry = defineSpells<Game, 'aimed'>({
      aimed: spell({ activation: { kind: 'button' }, timeline: { windup: { seconds: () => 1 } }, release }),
    });

    assert.ok(Number.isNaN(registry.columns.windup[0]));
  });

  it('builds a dispatch table per hook', () => {
    const registry = SPELLS();

    assert.equal(registry.hooks.release[3], release);
    assert.equal(registry.hooks.target[0], undefined);
    assert.notEqual(registry.hooks.target[1], undefined);
    assert.deepEqual(
      [0, 1, 3].filter((id) => registry.hooks.onHit[id] !== undefined),
      [3],
    );
  });

  it("holds each spell's tags as a bitset, and lists the auto spells in order", () => {
    const registry = SPELLS();

    assert.deepEqual(registry.tagSets[1]?.toArray(), [SPELL_TAGS.id.area, SPELL_TAGS.id.melee]);
    assert.deepEqual(registry.autoIds, [registry.id.swing]);
  });

  it('compiles a stats table at load, and the outgoing shares by stat id', () => {
    const registry = SPELLS();
    const compiled = registry.compiled[3];

    assert.deepEqual(compiled?.keys, ['damage', 'radius']);
    assert.deepEqual([...(compiled?.values[0]?.base ?? [])], [10, 20, 30]);
    assert.deepEqual([...(compiled?.values[1]?.base ?? [])], [4]);
    assert.equal(registry.compiled[0], undefined);
    assert.equal(registry.shares[3]?.[STATS.id.damage], 1.1);
    assert.ok(Number.isNaN(registry.shares[3]?.[STATS.id.power]));
    assert.equal(registry.shares[0], undefined);
  });

  it('freezes the definitions and keeps its hooks callable detached', () => {
    const registry = SPELLS();
    const def = registry.get(registry.id.slam);
    const { target } = def;

    assert.ok(Object.isFrozen(def));
    assert.ok(Object.isFrozen(def.activation));
    assert.equal(typeof target, 'function');
  });
});

/** The test game with open names, so a check can be handed what the game's own types would refuse. */
type Loose = Omit<Game, 'spellTag' | 'stat' | 'gameActivation'> & {
  readonly spellTag: string;
  readonly stat: string;
  readonly gameActivation: Totem;
};

/** A game's own activation kind: a totem that pulses. */
interface Totem extends ActivationShape {
  /** The discriminant. */
  readonly kind: 'totem';

  /** The seconds between pulses. */
  readonly pulse: number;
}

/** `defineSpell` over the open names. */
const loose = defineSpell<Loose>();

describe('checks at load', () => {
  /** Registers one spell named `broken`. */
  const one = (def: AnySpellDef<Loose>, options: SpellRegistryOptions<Loose> = {}) =>
    defineSpells<Loose, 'broken'>({ broken: def }, { tags: SPELL_TAGS, ...options });

  /** A copy of a definition with one field overwritten, whatever the types say. */
  const forged = (def: AnySpellDef<Loose>, field: string, value: unknown) => {
    const copy = { ...def };

    Reflect.set(copy, field, value);

    return copy;
  };

  const button = { kind: 'button' } as const;

  it('refuses an unknown activation kind, and data its kind refuses', () => {
    assert.throws(
      () => one(forged(loose({ activation: button, release }), 'activation', { kind: 'totem' })),
      /Spell broken: unknown activation kind totem/,
    );
    assert.throws(
      () => one(loose({ activation: { kind: 'auto', interval: 0 }, release })),
      /auto interval must be above 0/,
    );
    assert.throws(() => one(loose({ activation: { kind: 'ai', windup: -1 }, release })), /ai activation takes seconds/);
  });

  it('refuses ranks outside 1–255, an unknown tag, and a hook that is not a function', () => {
    assert.throws(() => one(loose({ activation: button, ranks: 0, release })), /ranks must be a whole number/);
    assert.throws(() => one(loose({ activation: button, tags: ['frost'], release })), /unknown spell tag frost/);
    assert.throws(
      () => one(forged(loose({ activation: button, release }), 'release', 3)),
      /release must be a function/,
    );
    assert.throws(() => one(forged(loose({ activation: button, release }), 'onHit', 3)), /onHit must be a function/);
  });

  it('refuses stage seconds below 0, a beat of 0, and an interrupt that neither pauses nor cancels', () => {
    assert.throws(
      () => one(loose({ activation: button, timeline: { recover: { seconds: -1 } }, release })),
      /stage lasts/,
    );
    assert.throws(
      () => one(loose({ activation: button, timeline: { channel: { seconds: 1, every: 0 } }, release })),
      /beat/,
    );

    const interrupts = {};

    Reflect.set(interrupts, 'stun', 'ignore');
    assert.throws(() => one(loose({ activation: button, timeline: { interrupts }, release })), /interrupt answers/);
  });

  it('refuses a scaled stat without a stat table, a rank list of the wrong length, and an unknown share', () => {
    assert.throws(
      () => one(loose({ activation: button, stats: { hit: scaled(1, add('power', 1)) }, release })),
      /stat table/,
    );
    assert.throws(
      () =>
        one(loose({ activation: button, ranks: 2, stats: { hit: scaled(ranks(1, 2, 3)) }, release }), { stats: STATS }),
      /Spell broken, hit: a per-rank list has 3 entries/,
    );
    assert.throws(
      () => one(loose({ activation: button, scaling: { armor: 1 }, release }), { stats: STATS }),
      /scaling names armor/,
    );
  });

  it("takes a game's own activation kinds, checked by the kind", () => {
    const totem = defineActivationKind<Totem, Loose>({
      check: (activation) => (activation.pulse > 0 ? undefined : 'a totem pulses.'),
    });

    const activations = defineActivations<Loose>({ ...CORE_ACTIVATIONS, totem });
    const make = (pulse: number) => one(loose({ activation: { kind: 'totem', pulse }, release }), { activations });

    assert.equal(make(2).columns.activation[0], activations.id['totem']);
    assert.throws(() => make(0), /Spell broken: a totem pulses/);
  });
});

describe('tracking helpers', () => {
  /** A windup of 1 s at `elapsed`, re-aiming at 9. */
  const at = (elapsed: number): TrackContext<number> => ({
    stageSeconds: 1,
    remaining: 1 - elapsed,
    elapsed,
    retarget: () => 9,
  });

  it('lockBefore re-aims until that many seconds before the release', () => {
    assert.equal(lockBefore(0.25)(at(0.5), 1), 9);
    assert.equal(lockBefore(0.25)(at(0.75), 1), 'lock');
  });

  it('lockAtShare re-aims until that share of the windup has passed', () => {
    assert.equal(lockAtShare(0.5)(at(0.25), 1), 9);
    assert.equal(lockAtShare(0.5)(at(0.5), 1), 'lock');
  });

  it('lockAtStart locks at once', () => {
    assert.equal(lockAtStart(at(0), 1), 'lock');
  });
});
