import {
  type Bitset,
  type Column,
  createBitset,
  createRegistry,
  type Registry,
  TOMBSTONE,
  type Tombstone,
} from '../core/index.ts';
import { checkAreaTrigger } from './area-checks.ts';
import type { AnyAreaTriggerDef } from './area-def.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import { type CompiledReplication, compileReplication } from './replication.ts';
import type { AreaTagTable } from './tags.ts';

/** Flag bit: its shape is a function, read again at every frame. */
const SHAPE_FUNCTION = 1;

/** Flag bit: a child of it ticks right after its parent. */
export const AFTER_PARENT = 2;

/** Flag bit: it sits on its owner. */
export const ANCHOR_OWNER = 4;

/** The lifetime kinds, in the order of their codes in the `lifetimeKind` column. */
const LIFETIME_KINDS = ['seconds', 'owner', 'spent', 'function'] as const;

/** The expiry modes, in the order of their codes in the `expiry` column. */
const EXPIRY_MODES = ['after', 'before', 'clip'] as const;

/** The hooks every area trigger registry builds dispatch tables for (§I.5.4). */
const AREA_TRIGGER_HOOKS = ['state', 'init', 'move', 'frame', 'onContact', 'onLand', 'onExpire', 'onEnd'] as const;

/** The name of one hook an area trigger registry dispatches. */
export type AreaTriggerHookName = (typeof AREA_TRIGGER_HOOKS)[number];

/**
 * The typed hot-field columns of an area trigger registry: the tick slot, the flag bits, the lifetime in seconds
 * (infinite for `owner` and `spent`, NaN for a function) and its kind's code, the expiry mode's code, and the limit per
 * owner (0 for none, NaN for a function).
 */
export type AreaTriggerColumn = 'slot' | 'flags' | 'lifetime' | 'lifetimeKind' | 'expiry' | 'limit';

/** The dispatch table of every area trigger hook, indexed by kind id, typed per hook. */
export type AreaTriggerHookTables<G extends AreaTriggerTypes> = {
  readonly [Hook in AreaTriggerHookName]: readonly (AnyAreaTriggerDef<G>[Hook] | undefined)[];
};

/**
 * The game's area trigger registry (`defineAreaTriggers`): ids by key order (the pinned kind order they tick in,
 * §II.6.1 rule 1), the definitions, typed columns, a dispatch table per hook (§I.5.4), and each
 * kind's tags as a bitset.
 */
export interface AreaTriggerRegistry<
  G extends AreaTriggerTypes = AreaTriggerTypes,
  Name extends string = string,
> extends Registry<'areaTriggers', Name, AnyAreaTriggerDef<G>, AreaTriggerColumn> {
  /** The dispatch table of every area trigger hook. */
  readonly hooks: AreaTriggerHookTables<G>;

  /** The game's area trigger tags. */
  readonly tags: AreaTagTable<G['areaTag']>;

  /** Each kind's tags, as a bitset over tag ids. */
  readonly tagSets: readonly Bitset[];

  /** Each kind's replication, resolved and checked at load (`events-only` for a tombstone). */
  readonly replication: readonly CompiledReplication[];
}

/** What an area trigger registry is built with, beyond its definitions. */
export interface AreaTriggerRegistryOptions<G extends AreaTriggerTypes> {
  /** The game's area trigger tags; none when absent. */
  readonly tags?: AreaTagTable<G['areaTag']>;

  /** The pinned order of the names, when it is not the key order. */
  readonly order?: readonly string[];

  /** Whether to deep-freeze every definition; true by default. */
  readonly freeze?: boolean;
}

/** Whether a registry entry is a definition, not the tombstone of a retired one. */
const isDef = <G extends AreaTriggerTypes>(entry: AnyAreaTriggerDef<G> | Tombstone): entry is AnyAreaTriggerDef<G> =>
  entry !== TOMBSTONE;

/** The definition of a registry entry, or `undefined` for a tombstone or a missing name. */
const liveDef = <G extends AreaTriggerTypes>(
  entry: AnyAreaTriggerDef<G> | Tombstone | undefined,
): AnyAreaTriggerDef<G> | undefined => (entry !== undefined && isDef(entry) ? entry : undefined);

/** The flag bits of a definition. */
const flagsOf = <G extends AreaTriggerTypes>(def: AnyAreaTriggerDef<G>): number =>
  (typeof def.shape === 'function' ? SHAPE_FUNCTION : 0) |
  (def.insert === 'after-parent' ? AFTER_PARENT : 0) |
  (def.anchor === 'owner' ? ANCHOR_OWNER : 0);

/** The lifetime in seconds: infinite for `owner` and `spent`, NaN for a function. */
const secondsOf = <G extends AreaTriggerTypes>(def: AnyAreaTriggerDef<G>): number => {
  const { lifetime } = def;

  if (typeof lifetime === 'number') {
    return lifetime;
  }

  return typeof lifetime === 'function' ? Number.NaN : Number.POSITIVE_INFINITY;
};

/** The code of a definition's lifetime kind. */
const lifetimeKindOf = <G extends AreaTriggerTypes>(def: AnyAreaTriggerDef<G>): number => {
  const { lifetime } = def;

  if (typeof lifetime === 'number') {
    return 0;
  }

  return typeof lifetime === 'function' ? 3 : LIFETIME_KINDS.indexOf(lifetime);
};

/** The limit per owner: 0 for none, NaN for a function. */
const limitOf = <G extends AreaTriggerTypes>(def: AnyAreaTriggerDef<G>): number => {
  const perOwner = def.limit?.perOwner ?? 0;

  return typeof perOwner === 'function' ? Number.NaN : perOwner;
};

/** A column of one number per slot (0 for a tombstone). */
const columnOf = <G extends AreaTriggerTypes, C extends Column>(
  column: C,
  slots: readonly (AnyAreaTriggerDef<G> | undefined)[],
  of: (def: AnyAreaTriggerDef<G>) => number,
): C => {
  for (const [index, def] of slots.entries()) {
    column[index] = def === undefined ? 0 : of(def);
  }

  return column;
};

/** The typed hot-field columns. */
const buildColumns = <G extends AreaTriggerTypes>(
  slots: readonly (AnyAreaTriggerDef<G> | undefined)[],
): Record<AreaTriggerColumn, Column> => {
  const size = slots.length;
  const modes: readonly string[] = EXPIRY_MODES;

  return {
    slot: columnOf(new Uint16Array(size), slots, (def) => def.tickIn ?? 0),
    flags: columnOf(new Uint8Array(size), slots, flagsOf),
    lifetime: columnOf(new Float64Array(size), slots, secondsOf),
    lifetimeKind: columnOf(new Uint8Array(size), slots, lifetimeKindOf),
    expiry: columnOf(new Uint8Array(size), slots, (def) => modes.indexOf(def.expiry ?? 'after')),
    limit: columnOf(new Float64Array(size), slots, limitOf),
  };
};

/** The dispatch table of one hook. */
const tableOf = <G extends AreaTriggerTypes, Hook extends AreaTriggerHookName>(
  slots: readonly (AnyAreaTriggerDef<G> | undefined)[],
  hook: Hook,
): readonly (AnyAreaTriggerDef<G>[Hook] | undefined)[] => Object.freeze(slots.map((def) => def?.[hook]));

/** The dispatch tables of every hook. */
const buildHooks = <G extends AreaTriggerTypes>(
  slots: readonly (AnyAreaTriggerDef<G> | undefined)[],
): AreaTriggerHookTables<G> => ({
  state: tableOf(slots, 'state'),
  init: tableOf(slots, 'init'),
  move: tableOf(slots, 'move'),
  frame: tableOf(slots, 'frame'),
  onContact: tableOf(slots, 'onContact'),
  onLand: tableOf(slots, 'onLand'),
  onExpire: tableOf(slots, 'onExpire'),
  onEnd: tableOf(slots, 'onEnd'),
});

/** The table of no area trigger tags, for a game that declares none. */
const NO_TAGS: AreaTagTable = createRegistry({}, { kind: 'areaTags' });

/**
 * Registers the game's area trigger kinds (§I.5.2, §II.3.4): `defineAreaTriggers({ cyclone, pool }, { tags })` gives
 * each its dense id by key order (its wire id, and the kind order they tick in within a slot), checks every definition
 * at load, freezes it, and builds the typed columns, hook tables and tag bitsets the system reads. `TOMBSTONE` keeps a
 * retired slot.
 */
export const defineAreaTriggers = <G extends AreaTriggerTypes, const Name extends string>(
  defs: Readonly<Record<Name, AnyAreaTriggerDef<G> | Tombstone>>,
  options: AreaTriggerRegistryOptions<G> = {},
): AreaTriggerRegistry<G, Name> => {
  const tags = options.tags ?? NO_TAGS;
  const byName = new Map(Object.entries<AnyAreaTriggerDef<G> | Tombstone>(defs));

  for (const [name, def] of byName) {
    if (isDef(def)) {
      checkAreaTrigger(name, def, tags);
    }
  }

  const { order, freeze } = options;

  // The core registry assigns the ids, pins the order and freezes; the typed tables are built here, since the core's
  // hook typing cannot see through a generic `G`.
  const base = createRegistry<Readonly<Record<string, object>>, 'areaTriggers'>(defs, {
    kind: 'areaTriggers',
    ...(order === undefined ? {} : { order }),
    ...(freeze === undefined ? {} : { freeze }),
  });

  const slots = Object.freeze(base.names.map((name) => liveDef(byName.get(name))));
  const tagIds: Readonly<Record<string, number | undefined>> = tags.id;

  return Object.freeze({
    ...base,
    defs: slots,

    get: (id: AreaTriggerId): AnyAreaTriggerDef<G> => {
      base.get(id);

      return slots[id] ?? { shape: { kind: 'point', at: { x: 0, z: 0 } }, lifetime: 1 };
    },

    columns: buildColumns(slots),
    hooks: buildHooks(slots),
    tags,
    tagSets: Object.freeze(slots.map((def) => createBitset((def?.tags ?? []).map((tag) => tagIds[tag] ?? 0)))),
    replication: Object.freeze(slots.map((def, id) => compileReplication(base.names[id] ?? '?', def))),
  });
};
