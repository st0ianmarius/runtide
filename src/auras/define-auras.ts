import {
  type Bitset,
  type Column,
  createBitset,
  createRegistry,
  type Registry,
  TOMBSTONE,
  type Tombstone,
} from '../core/index.ts';
import { recordOf } from '../core/records.ts';
import type { AuraDef, AuraStacking } from './aura-def.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';

/** The built-in stacking rules, by column code; a game's own rule is `CUSTOM_STACKING`. */
export const STACKINGS: readonly AuraStacking[] = ['refresh', 'extend', 'stack', 'highest', 'keep', 'independent'];

/** The column code of a stacking rule written as a function. */
export const CUSTOM_STACKING = STACKINGS.length;

/** The built-in value merges, by column code; a game's own merge is `CUSTOM_MERGE`. */
export const MERGES = ['replace', 'max', 'add'] as const;

/** The column code of a merge written as a function. */
export const CUSTOM_MERGE = MERGES.length;

/** Flag bit: each source keeps its own instance. */
export const PER_SOURCE = 1;

/** Flag bit: the first source keeps the credit. */
export const CREDIT_FIRST = 2;

/** Flag bit: it stays when its value is spent. */
export const KEEP_DEPLETED = 4;

/** Flag bit: only its bearer's own client sees it. */
export const OWNER_ONLY = 8;

/** Flag bit: it is removed when its source is gone. */
export const BOUND_TO_SOURCE = 16;

/** Flag bit: a prediction mirror rebuilds it from the wire. */
export const PREDICTED = 32;

/** The most stacks an aura can declare. */
const MAX_STACKS = 65_535;

/** The hooks every aura registry builds dispatch tables and `has` bitsets for. */
export const AURA_HOOKS = [
  'onLand',
  'onApplied',
  'onRefreshed',
  'onExpired',
  'onRemoved',
  'onState',
  'activeWhile',
  'expiresWhen',
  'onIgnore',
  'onIncomingDamage',
  'onLethal',
  'onOutgoingDamage',
  'onDealt',
  'onIncomingForce',
] as const;

/** The name of one hook an aura registry dispatches. */
export type AuraHookName = (typeof AURA_HOOKS)[number];

/** The typed hot-field columns of an aura registry. */
export type AuraColumn = 'stacking' | 'maxStacks' | 'merge' | 'flags';

/** The dispatch table of every aura hook, indexed by aura id, typed per hook. */
export type AuraHookTables<G extends AuraTypes> = {
  readonly [Hook in AuraHookName]: readonly (AuraDef<G>[Hook] | undefined)[];
};

/**
 * The game's aura registry (`defineAuras`): ids by key order, the definitions, typed columns (`stacking`,
 * `maxStacks`, `merge`, `flags`), and a dispatch table and `has` bitset per hook.
 */
export interface AuraRegistry<G extends AuraTypes = AuraTypes, Name extends string = string> extends Registry<
  'auras',
  Name,
  AuraDef<G>,
  AuraColumn
> {
  /** The dispatch table of every aura hook. */
  readonly hooks: AuraHookTables<G>;

  /** The ids that have each hook. */
  readonly has: Readonly<Record<AuraHookName, Bitset>>;
}

/** The column code of a definition's stacking rule. */
const stackingCode = <G extends AuraTypes>(def: AuraDef<G>): number =>
  typeof def.stacking === 'function' ? CUSTOM_STACKING : STACKINGS.indexOf(def.stacking ?? 'refresh');

/** The column code of a definition's value merge. */
const mergeCode = <G extends AuraTypes>(def: AuraDef<G>): number =>
  typeof def.merge === 'function' ? CUSTOM_MERGE : MERGES.indexOf(def.merge ?? 'replace');

/** The flag bits of a definition. */
const flagsOf = <G extends AuraTypes>(def: AuraDef<G>): number =>
  (def.perSource === true ? PER_SOURCE : 0) |
  (def.credit === 'first' ? CREDIT_FIRST : 0) |
  (def.keepWhenDepleted === true ? KEEP_DEPLETED : 0) |
  (def.ownerOnly === true ? OWNER_ONLY : 0) |
  (def.boundToSource === true ? BOUND_TO_SOURCE : 0) |
  (def.predicted === true ? PREDICTED : 0);

/** Whether a duration is sound: absent, infinite, a function, or a finite number of seconds from 0. */
const isSoundDuration = (duration: unknown): boolean =>
  typeof duration !== 'number' || (Number.isFinite(duration) && duration >= 0);

/** Whether a periodic period is sound: a function, or a finite number of seconds from 0. */
const isSoundPeriod = (every: unknown): boolean =>
  typeof every === 'function' || (typeof every === 'number' && Number.isFinite(every) && every >= 0);

/** Whether a registry entry is a definition, not the tombstone of a retired one. */
const isDef = <G extends AuraTypes>(entry: AuraDef<G> | Tombstone): entry is AuraDef<G> => entry !== TOMBSTONE;

/** Throws unless a definition's stack cap and rules are sound, naming it. */
const checkRules = <G extends AuraTypes>(name: string, def: AuraDef<G>): void => {
  const maxStacks = def.maxStacks ?? 1;

  if (!Number.isInteger(maxStacks) || maxStacks < 1 || maxStacks > MAX_STACKS) {
    throw new RangeError(`Aura ${name}: maxStacks must be a whole number from 1 to ${MAX_STACKS}.`);
  }

  if (stackingCode(def) < 0 || mergeCode(def) < 0) {
    throw new RangeError(`Aura ${name}: unknown stacking or merge rule.`);
  }
};

/** Throws unless a definition's numbers and rules are sound, naming it. */
const checkDef = <G extends AuraTypes>(name: string, def: AuraDef<G>): void => {
  checkRules(name, def);

  if (!isSoundDuration(def.duration) || !Number.isFinite(def.value ?? 0)) {
    throw new RangeError(`Aura ${name}: duration must be seconds from 0, 'infinite' or a function; value finite.`);
  }

  if (def.periodic !== undefined && !isSoundPeriod(def.periodic.every)) {
    throw new RangeError(`Aura ${name}: periodic.every must be seconds from 0 or a function.`);
  }

  if (def.perSource === true && def.stacking === 'independent') {
    throw new RangeError(`Aura ${name}: an independent aura already keeps one instance per application.`);
  }
};

/** The definition of a registry entry, or `undefined` for a tombstone or a missing name. */
const liveDef = <G extends AuraTypes>(entry: AuraDef<G> | Tombstone | undefined): AuraDef<G> | undefined =>
  entry !== undefined && isDef(entry) ? entry : undefined;

/** A column of one number per slot (0 for a tombstone). */
const columnOf = <G extends AuraTypes, C extends Column>(
  column: C,
  slots: readonly (AuraDef<G> | undefined)[],
  of: (def: AuraDef<G>) => number,
): C => {
  for (const [index, def] of slots.entries()) {
    column[index] = def === undefined ? 0 : of(def);
  }

  return column;
};

/** The typed hot-field columns. */
const buildColumns = <G extends AuraTypes>(slots: readonly (AuraDef<G> | undefined)[]): Record<AuraColumn, Column> => ({
  stacking: columnOf(new Uint8Array(slots.length), slots, stackingCode),
  maxStacks: columnOf(new Uint16Array(slots.length), slots, (def) => def.maxStacks ?? 1),
  merge: columnOf(new Uint8Array(slots.length), slots, mergeCode),
  flags: columnOf(new Uint8Array(slots.length), slots, flagsOf),
});

/** The dispatch table of one hook. */
const tableOf = <G extends AuraTypes, Hook extends AuraHookName>(
  slots: readonly (AuraDef<G> | undefined)[],
  hook: Hook,
): readonly (AuraDef<G>[Hook] | undefined)[] => {
  const table = slots.map((def) => def?.[hook]);

  if (table.some((value) => value !== undefined && typeof value !== 'function')) {
    throw new TypeError(`Aura hook ${hook} must be a function.`);
  }

  return Object.freeze(table);
};

/** The dispatch tables of every hook. */
const buildHooks = <G extends AuraTypes>(slots: readonly (AuraDef<G> | undefined)[]): AuraHookTables<G> => ({
  onLand: tableOf(slots, 'onLand'),
  onApplied: tableOf(slots, 'onApplied'),
  onRefreshed: tableOf(slots, 'onRefreshed'),
  onExpired: tableOf(slots, 'onExpired'),
  onRemoved: tableOf(slots, 'onRemoved'),
  onState: tableOf(slots, 'onState'),
  activeWhile: tableOf(slots, 'activeWhile'),
  expiresWhen: tableOf(slots, 'expiresWhen'),
  onIgnore: tableOf(slots, 'onIgnore'),
  onIncomingDamage: tableOf(slots, 'onIncomingDamage'),
  onLethal: tableOf(slots, 'onLethal'),
  onOutgoingDamage: tableOf(slots, 'onOutgoingDamage'),
  onDealt: tableOf(slots, 'onDealt'),
  onIncomingForce: tableOf(slots, 'onIncomingForce'),
});

/** The `has` bitset of every hook. */
const buildHas = <G extends AuraTypes>(
  slots: readonly (AuraDef<G> | undefined)[],
): Readonly<Record<AuraHookName, Bitset>> =>
  recordOf(AURA_HOOKS, (hook) =>
    createBitset(slots.flatMap((def, index) => (def?.[hook] === undefined ? [] : [index]))),
  );

/**
 * Registers the game's auras: `defineAuras({ bleed, stun, … })` gives each its dense id by key order (its
 * fold order, walk order and wire id), checks every definition, freezes it, and builds the typed columns and hook
 * tables the system reads. `TOMBSTONE` keeps a retired slot; `order` pins the order of a derived registry.
 */
export const defineAuras = <G extends AuraTypes, const Name extends string>(
  defs: Readonly<Record<Name, AuraDef<G> | Tombstone>>,
  options: {
    /** The pinned order of the names, when it is not the key order. */
    readonly order?: readonly string[];

    /** Whether to deep-freeze every definition; true by default. */
    readonly freeze?: boolean;
  } = {},
): AuraRegistry<G, Name> => {
  const byName = new Map(Object.entries<AuraDef<G> | Tombstone>(defs));

  for (const [name, def] of byName) {
    if (isDef(def)) {
      checkDef(name, def);
    }
  }

  // The core registry assigns the ids, pins the order and freezes; the typed tables are built here, since the core's
  // hook typing cannot see through a generic `G`.
  const base = createRegistry<Readonly<Record<string, object>>, 'auras'>(defs, { kind: 'auras', ...options });
  const slots = Object.freeze(base.names.map((name) => liveDef(byName.get(name))));

  return Object.freeze({
    ...base,
    defs: slots,

    get: (id: AuraId): AuraDef<G> => {
      base.get(id);

      return slots[id] ?? {};
    },

    columns: buildColumns(slots),
    hooks: buildHooks(slots),
    has: buildHas(slots),
  });
};
