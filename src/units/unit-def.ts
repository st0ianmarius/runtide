import { type Bitset, createBitset, createRegistry, type Registry, TOMBSTONE, type Tombstone } from '../core/index.ts';
import type { StatTable } from '../modifiers/index.ts';
import type { UnitTagTable } from './tags.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * A unit template: its base stats, class tags, auto-attack spell and the game's own data. A
 * spawned unit snapshots its template's stats (with the spawn's own on top), so a later change to the template does
 * not reach it.
 */
export interface UnitDef<G extends UnitTypes = UnitTypes> {
  /** Its base stats, by stat name, over the stat table's bases; every stat it leaves out keeps the table's base. */
  readonly stats?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Its class tags. */
  readonly tags?: readonly G['unitTag'][];

  /**
   * Its auto-attack spell, by name (an `auto` spell), for a creature's melee swing: armed on every unit
   * spawned (`spells.arm`), so `spells.stepAuto` steps it. Optional, and absent for most heroes: the game arms their
   * attacks as they gain them (their cards), not a template.
   */
  readonly autoAttack?: G['spellName'];

  /** Its script, by name: the behaviours every unit of it runs; none when absent. */
  readonly script?: G['scriptName'];

  /** The game's own data (rewards, a roster's rules), typed by the game; the framework never reads it. */
  readonly data?: G['unitData'];
}

/** Fixes a unit template's types; returns it unchanged. */
export const defineUnit =
  <G extends UnitTypes>() =>
  (def: UnitDef<G>): UnitDef<G> =>
    def;

/** The game's unit templates, compiled: ids by key order, base stat vectors and tag bitsets. */
export interface UnitRegistry<G extends UnitTypes = UnitTypes, Name extends string = string> extends Registry<
  'units',
  Name,
  UnitDef<G>,
  never
> {
  /** The stat table the base vectors are laid out over. */
  readonly stats: StatTable<G['stat']>;

  /** The game's unit class tags. */
  readonly tags: UnitTagTable<G['unitTag']>;

  /** Each template's base stats, one number per stat id. */
  readonly bases: readonly Float64Array[];

  /** Each template's class tags, as a bitset over tag ids. */
  readonly tagSets: readonly Bitset[];
}

/** What a unit registry is built with. */
export interface UnitRegistryOptions<G extends UnitTypes> {
  /** The game's stat table. */
  readonly stats: StatTable<G['stat']>;

  /** The game's unit class tags; none when absent. */
  readonly tags?: UnitTagTable<G['unitTag']>;
}

/** A problem with a template's stats, as a sentence, or `undefined`. */
const statProblem = <G extends UnitTypes>(def: UnitDef<G>, options: UnitRegistryOptions<G>): string | undefined => {
  for (const [stat, value] of Object.entries<number | undefined>(def.stats ?? {})) {
    if (options.stats.index.idOf(stat) === undefined) {
      return `there is no stat named ${stat}.`;
    }

    if (value === undefined || !Number.isFinite(value)) {
      return `its ${stat} must be a finite number.`;
    }
  }

  return undefined;
};

/** Throws unless a template's stats and tags are sound. */
const checkDef = <G extends UnitTypes>(name: string, def: UnitDef<G>, options: UnitRegistryOptions<G>): void => {
  const refuse = (problem: string): never => {
    throw new RangeError(`Unit ${name}: ${problem}`);
  };

  const stats = statProblem(def, options);

  if (stats !== undefined) {
    refuse(stats);
  }

  const tagIds: Readonly<Record<string, number | undefined>> = options.tags?.id ?? {};
  const unknown = (def.tags ?? []).find((tag) => tagIds[tag] === undefined);

  if (unknown !== undefined) {
    refuse(`there is no unit tag named ${unknown}.`);
  }
};

/** A template's base stat vector: the table's bases, with its own on top. */
const baseOf = <G extends UnitTypes>(def: UnitDef<G> | undefined, stats: StatTable<G['stat']>): Float64Array => {
  const base = Float64Array.from(stats.columns.base);

  for (const [stat, value] of Object.entries<number | undefined>(def?.stats ?? {})) {
    const id = stats.index.idOf(stat);

    if (id !== undefined && value !== undefined) {
      base[id] = value;
    }
  }

  return base;
};

/** Whether a registry entry is a template, not the tombstone of a retired one. */
const isDef = <G extends UnitTypes>(entry: UnitDef<G> | Tombstone): entry is UnitDef<G> => entry !== TOMBSTONE;

/** No unit tags, for a game that declares none. */
const NO_TAGS: UnitTagTable = createRegistry({}, { kind: 'unitTags' });

/**
 * Registers the game's unit templates: `defineUnits({ grunt, brute, totem }, { stats: STATS, tags:
 * UNIT_TAGS })` gives each its dense id by key order, checks it at load, and lays out its base stats and
 * class tags for the unit system. `TOMBSTONE` keeps a retired slot.
 */
export const defineUnits = <G extends UnitTypes, const Name extends string>(
  defs: Readonly<Record<Name, UnitDef<G> | Tombstone>>,
  options: UnitRegistryOptions<G>,
): UnitRegistry<G, Name> => {
  const byName = new Map(Object.entries<UnitDef<G> | Tombstone>(defs));

  for (const [name, def] of byName) {
    if (isDef(def)) {
      checkDef(name, def, options);
    }
  }

  const base = createRegistry<Readonly<Record<string, object>>, 'units'>(defs, { kind: 'units' });
  const tags = options.tags ?? NO_TAGS;
  const tagIds: Readonly<Record<string, number | undefined>> = tags.id;

  const slots = base.names.map((name): UnitDef<G> | undefined => {
    const def = byName.get(name);

    return def !== undefined && isDef(def) ? def : undefined;
  });

  return Object.freeze({
    ...base,
    defs: Object.freeze(slots),

    get: (id: UnitId): UnitDef<G> => {
      base.get(id);

      return slots[id] ?? {};
    },

    stats: options.stats,
    tags,
    bases: Object.freeze(slots.map((def) => baseOf(def, options.stats))),
    tagSets: Object.freeze(slots.map((def) => createBitset((def?.tags ?? []).map((tag) => tagIds[tag] ?? 0)))),
  });
};
