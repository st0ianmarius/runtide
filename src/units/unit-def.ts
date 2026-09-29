import { type Bitset, createBitset, createRegistry, type Registry, TOMBSTONE, type Tombstone } from '../core/index.ts';
import type { StatTable } from '../modifiers/index.ts';
import type { UnitTagTable } from './tags.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * A unit's traits (§II.6 U2): what the framework's pipelines read about it instead of its id or class. They replace a
 * game's `heavyKind`, `isObjective` and immovable lists.
 */
export interface UnitTraits {
  /** A heavy body (the world's pushing, a game's rules). */
  readonly heavy?: boolean;

  /** An objective: a side of its own, which the game's targeting and kill accounting leave out. */
  readonly objective?: boolean;

  /** Never moved by a force. */
  readonly immovable?: boolean;

  /** No rewards and no kill event when it dies (§II.6 D5): a wall, a totem. */
  readonly inert?: boolean;

  /** Never pulled (a boss); knockbacks and pushes still move it. */
  readonly pullImmune?: boolean;

  /** Not moved by a force while it casts (a caster holding its ground). */
  readonly holdsGround?: boolean;

  /** How much of a force's strength moves it, and the most that ever does (an elite: × 0.5, capped at 1.5). */
  readonly knockResist?: {
    /** The share of a force's strength it takes, from 0. */
    readonly factor: number;

    /** The largest strength it takes; no cap when absent. */
    readonly cap?: number;
  };
}

/**
 * A unit template (§II.6 U1): its base stats, class tags, traits, auto-attack spell and reward numbers, as data. A
 * spawned unit snapshots its template's stats (with the spawn's own on top), so a later change to the template does
 * not reach it.
 */
export interface UnitDef<G extends UnitTypes = UnitTypes> {
  /** Its base stats, by stat name, over the stat table's bases; every stat it leaves out keeps the table's base. */
  readonly stats?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Its class tags. */
  readonly tags?: readonly G['unitTag'][];

  /** Its traits. */
  readonly traits?: UnitTraits;

  /**
   * Its auto-attack spell, by name (an `auto` spell the game's loop steps), for a creature's melee swing (§II.6 S3).
   * Optional, and absent for most heroes: their attacks are the spells they own (the spellbook, F20), not a template's.
   */
  readonly autoAttack?: G['spellName'];

  /** Its reward and kill-accounting numbers (souls, experience), which the game's death steps read. */
  readonly rewards?: Readonly<Record<string, number>>;
}

/** Fixes a unit template's types; returns it unchanged. */
export const defineUnit =
  <G extends UnitTypes>() =>
  (def: UnitDef<G>): UnitDef<G> =>
    def;

/** Trait bit: heavy. */
export const HEAVY = 1;

/** Trait bit: an objective. */
export const OBJECTIVE = 2;

/** Trait bit: immovable. */
export const IMMOVABLE = 4;

/** Trait bit: inert. */
export const INERT = 8;

/** Trait bit: never pulled. */
export const PULL_IMMUNE = 16;

/** Trait bit: holds its ground while casting. */
export const HOLDS_GROUND = 32;

/** The game's unit templates, compiled (§I.5.4): ids by key order, base stat vectors, trait bits and tag bitsets. */
export interface UnitRegistry<G extends UnitTypes = UnitTypes, Name extends string = string> extends Registry<
  'units',
  Name,
  UnitDef<G>,
  never,
  never
> {
  /** The stat table the base vectors are laid out over. */
  readonly stats: StatTable<G['stat']>;

  /** The game's unit class tags. */
  readonly tags: UnitTagTable<G['unitTag']>;

  /** Each template's base stats, one number per stat id. */
  readonly bases: readonly Float64Array[];

  /** Each template's trait bits. */
  readonly traits: Uint8Array;

  /** Each template's force factor (1 for none). */
  readonly knockFactor: Float64Array;

  /** Each template's force cap (`Infinity` for none). */
  readonly knockCap: Float64Array;

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

/** Each flag trait and its bit. */
const TRAIT_BITS: readonly (readonly [Exclude<keyof UnitTraits, 'knockResist'>, number])[] = [
  ['heavy', HEAVY],
  ['objective', OBJECTIVE],
  ['immovable', IMMOVABLE],
  ['inert', INERT],
  ['pullImmune', PULL_IMMUNE],
  ['holdsGround', HOLDS_GROUND],
];

/** The trait bits of a template. */
const traitBits = (traits: UnitTraits | undefined): number =>
  TRAIT_BITS.reduce((bits, [trait, bit]) => (traits?.[trait] === true ? bits | bit : bits), 0);

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

/** Throws unless a template's stats, tags and force resistance are sound. */
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

  const resist = def.traits?.knockResist;

  if (resist !== undefined && (!(resist.factor >= 0) || !(resist.cap === undefined || resist.cap >= 0))) {
    refuse('its knock resist takes a factor and a cap from 0.');
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
 * Registers the game's unit templates (§II.6 U1): `defineUnits({ grunt, brute, totem }, { stats: STATS, tags:
 * UNIT_TAGS })` gives each its dense id by key order, checks it at load, and lays out its base stats, trait bits and
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
    traits: Uint8Array.from(slots, (def) => traitBits(def?.traits)),
    knockFactor: Float64Array.from(slots, (def) => def?.traits?.knockResist?.factor ?? 1),
    knockCap: Float64Array.from(slots, (def) => def?.traits?.knockResist?.cap ?? Number.POSITIVE_INFINITY),
    tagSets: Object.freeze(slots.map((def) => createBitset((def?.tags ?? []).map((tag) => tagIds[tag] ?? 0)))),
  });
};
