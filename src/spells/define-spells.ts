import {
  type Bitset,
  type Column,
  createBitset,
  createRegistry,
  type Registry,
  TOMBSTONE,
  type Tombstone,
} from '../core/index.ts';
import type { StatTable } from '../modifiers/index.ts';
import { type ActivationRegistry, CORE_ACTIVATIONS, defineActivations } from './activation.ts';
import { constantOf, planOf } from './cast-plan.ts';
import { type CompiledStats, compileShares, compileStats, isStatsTable } from './compile-stats.ts';
import { CAST_OUTCOMES } from './events.ts';
import { checkSpell } from './spell-checks.ts';
import type { AnySpellDef, CastOutcome } from './spell-def.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import type { SpellTagTable } from './tags.ts';

/** Flag bit: its hooks read its stats live, evaluated again before each one. */
export const LIVE = 1;

/** Flag bit: its stats are a table of scaled values. */
export const STATS_TABLE = 2;

/** Flag bit: its stats are a function. */
export const STATS_FUNCTION = 4;

/** The hooks every spell registry builds dispatch tables for. */
const SPELL_HOOKS = ['state', 'canCast', 'target', 'begin', 'release', 'onHit', 'onEnd'] as const;

/** The name of one hook a spell registry dispatches. */
export type SpellHookName = (typeof SPELL_HOOKS)[number];

/**
 * The typed hot-field columns of a spell registry: the activation kind's id, the ranks, the flag bits, and each
 * stage's constant seconds (NaN when read per cast, 0 for a stage it does not have) with the channel's beat.
 */
export type SpellColumn = 'activation' | 'ranks' | 'flags' | 'windup' | 'channel' | 'every' | 'recover';

/** The dispatch table of every spell hook, indexed by spell id, typed per hook. */
export type SpellHookTables<G extends SpellTypes> = {
  readonly [Hook in SpellHookName]: readonly (AnySpellDef<G>[Hook] | undefined)[];
};

/**
 * The game's spell registry (`defineSpells`): ids by key order, the definitions, typed columns, a dispatch table per
 * hook, each spell's tags as a bitset, its compiled stats table and its outgoing shares.
 */
export interface SpellRegistry<G extends SpellTypes = SpellTypes, Name extends string = string> extends Registry<
  'spells',
  Name,
  AnySpellDef<G>,
  SpellColumn
> {
  /** The dispatch table of every spell hook. */
  readonly hooks: SpellHookTables<G>;

  /** The activation kinds its spells use. */
  readonly activations: ActivationRegistry<G>;

  /** The game's spell tags. */
  readonly tags: SpellTagTable<G['spellTag']>;

  /** The game's stat table, when the spells scale with stats. */
  readonly stats: StatTable<G['stat']> | undefined;

  /** Each spell's tags, as a bitset over tag ids. */
  readonly tagSets: readonly Bitset[];

  /** Each spell's compiled stats table; `undefined` for a function or no stats. */
  readonly compiled: readonly (CompiledStats | undefined)[];

  /** Each spell's outgoing shares by stat id, NaN for a stat it leaves out; `undefined` when it declares none. */
  readonly shares: readonly (Float64Array | undefined)[];

  /**
   * Every way a cast can end, in code order (what an `outcome` filter resolves to and the combat log codes by): the
   * framework's (`CAST_OUTCOMES`), then the game's own.
   */
  readonly outcomes: readonly CastOutcome<G>[];
}

/** What a spell registry is built with, beyond its definitions. */
export interface SpellRegistryOptions<G extends SpellTypes> {
  /** The activation kinds (`defineActivations`); the framework's own (`CORE_ACTIVATIONS`) when absent. */
  readonly activations?: ActivationRegistry<G>;

  /** The game's spell tags; none when absent. */
  readonly tags?: SpellTagTable<G['spellTag']>;

  /** The game's stat table, which scaled stats and `scaling` name stats in. */
  readonly stats?: StatTable<G['stat']>;

  /** The game's own cast outcomes (`blocked`), which `spells.finish` may end a cast with; none when absent. */
  readonly outcomes?: readonly G['castOutcome'][];

  /** The pinned order of the names, when it is not the key order. */
  readonly order?: readonly string[];

  /** Whether to deep-freeze every definition; true by default. */
  readonly freeze?: boolean;
}

/** Whether a registry entry is a definition, not the tombstone of a retired one. */
const isDef = <G extends SpellTypes>(entry: AnySpellDef<G> | Tombstone): entry is AnySpellDef<G> => entry !== TOMBSTONE;

/** The definition of a registry entry, or `undefined` for a tombstone or a missing name. */
const liveDef = <G extends SpellTypes>(entry: AnySpellDef<G> | Tombstone | undefined): AnySpellDef<G> | undefined =>
  entry !== undefined && isDef(entry) ? entry : undefined;

/** The flag bits of a definition. */
const flagsOf = <G extends SpellTypes>(def: AnySpellDef<G>): number =>
  (def.live === true ? LIVE : 0) |
  (isStatsTable<G>(def.stats) ? STATS_TABLE : 0) |
  (typeof def.stats === 'function' ? STATS_FUNCTION : 0);

/** A column of one number per slot (0 for a tombstone). */
const columnOf = <G extends SpellTypes, C extends Column>(
  column: C,
  slots: readonly (AnySpellDef<G> | undefined)[],
  of: (def: AnySpellDef<G>) => number,
): C => {
  for (const [index, def] of slots.entries()) {
    column[index] = def === undefined ? 0 : of(def);
  }

  return column;
};

/** The typed hot-field columns. */
const buildColumns = <G extends SpellTypes>(
  slots: readonly (AnySpellDef<G> | undefined)[],
  [activations, names]: readonly [ActivationRegistry<G>, readonly string[]],
): Record<SpellColumn, Column> => {
  const kindIds: Readonly<Record<string, number | undefined>> = activations.id;
  const plans = slots.map((def, id) => (def === undefined ? undefined : planOf(def, names[id] ?? '')));
  const size = slots.length;

  return {
    activation: columnOf(new Uint8Array(size), slots, (def) => kindIds[def.activation.kind] ?? 0),
    ranks: columnOf(new Uint8Array(size), slots, (def) => def.ranks ?? 1),
    flags: columnOf(new Uint8Array(size), slots, flagsOf),
    windup: Float64Array.from(plans, (plan) => constantOf(plan?.windup)),
    channel: Float64Array.from(plans, (plan) => constantOf(plan?.channel)),
    every: Float64Array.from(plans, (plan) => constantOf(plan?.every)),
    recover: Float64Array.from(plans, (plan) => constantOf(plan?.recover)),
  };
};

/** The dispatch table of one hook. */
const tableOf = <G extends SpellTypes, Hook extends SpellHookName>(
  slots: readonly (AnySpellDef<G> | undefined)[],
  hook: Hook,
): readonly (AnySpellDef<G>[Hook] | undefined)[] => Object.freeze(slots.map((def) => def?.[hook]));

/** The dispatch tables of every hook. */
const buildHooks = <G extends SpellTypes>(slots: readonly (AnySpellDef<G> | undefined)[]): SpellHookTables<G> => ({
  state: tableOf(slots, 'state'),
  canCast: tableOf(slots, 'canCast'),
  target: tableOf(slots, 'target'),
  begin: tableOf(slots, 'begin'),
  release: tableOf(slots, 'release'),
  onHit: tableOf(slots, 'onHit'),
  onEnd: tableOf(slots, 'onEnd'),
});

/** Each spell's tags as a bitset. */
const buildTagSets = <G extends SpellTypes>(
  slots: readonly (AnySpellDef<G> | undefined)[],
  tags: SpellTagTable<G['spellTag']>,
): readonly Bitset[] => {
  const ids: Readonly<Record<string, number | undefined>> = tags.id;

  return Object.freeze(slots.map((def) => createBitset((def?.tags ?? []).map((tag) => ids[tag] ?? 0))));
};

/** The framework's outcomes, then the game's; throws for a game outcome named twice or named like the framework's. */
const outcomesOf = <G extends SpellTypes>(own: readonly G['castOutcome'][] = []): readonly CastOutcome<G>[] => {
  const all: CastOutcome<G>[] = [...CAST_OUTCOMES];

  for (const outcome of own) {
    if (all.includes(outcome)) {
      throw new RangeError(`Spells: the cast outcome ${outcome} is named twice.`);
    }

    all.push(outcome);
  }

  return Object.freeze(all);
};

/** The table of no spell tags, for a game that declares none. */
const NO_TAGS: SpellTagTable = createRegistry({}, { kind: 'spellTags' });

/** The framework's activation kinds, registered once. */
const CORE_KINDS: ActivationRegistry<never> = defineActivations<never>(CORE_ACTIVATIONS);

/**
 * Registers the game's spells: `defineSpells({ frostNova, blast }, { tags: SPELL_TAGS, stats:
 * STATS })` gives each its dense id by key order (its wire id), checks every definition at load (its activation's kind
 * and data, ranks, tags, timeline seconds, hooks), compiles its stats table and shares against the stat table, freezes
 * it, and builds the typed columns, hook tables and tag bitsets the system reads. `TOMBSTONE` keeps a retired slot.
 */
export const defineSpells = <G extends SpellTypes, const Name extends string>(
  defs: Readonly<Record<Name, AnySpellDef<G> | Tombstone>>,
  options: SpellRegistryOptions<G> = {},
): SpellRegistry<G, Name> => {
  const activations: ActivationRegistry<G> = options.activations ?? CORE_KINDS;
  const tags = options.tags ?? NO_TAGS;
  const byName = new Map(Object.entries<AnySpellDef<G> | Tombstone>(defs));

  for (const [name, def] of byName) {
    if (isDef(def)) {
      checkSpell(name, def, { activations, tags });
    }
  }

  const { order, freeze } = options;

  // The core registry assigns the ids, pins the order and freezes; the typed tables are built here, since the core's
  // hook typing cannot see through a generic `G`.
  const base = createRegistry<Readonly<Record<string, object>>, 'spells'>(defs, {
    kind: 'spells',
    ...(order === undefined ? {} : { order }),
    ...(freeze === undefined ? {} : { freeze }),
  });

  const slots = Object.freeze(base.names.map((name) => liveDef(byName.get(name))));
  const columns = buildColumns(slots, [activations, base.names]);

  return Object.freeze({
    ...base,
    defs: slots,

    get: (id: SpellId): AnySpellDef<G> => {
      base.get(id);

      return slots[id] ?? { activation: { kind: 'trigger' }, release: () => undefined };
    },

    columns,
    hooks: buildHooks(slots),
    activations,
    tags,
    stats: options.stats,
    tagSets: buildTagSets(slots, tags),
    compiled: Object.freeze(slots.map((def, id) => def && compileStats(base.names[id] ?? '', def, options.stats))),
    shares: Object.freeze(slots.map((def, id) => def && compileShares(base.names[id] ?? '', def, options.stats))),
    outcomes: outcomesOf<G>(options.outcomes),
  });
};
