import { type AuraDef, defineAura } from '../auras/index.ts';
import { TOMBSTONE, type Tombstone } from '../core/index.ts';
import { isTriggerDef, type TriggerTypes } from './trigger-types.ts';

/** The name of an internal-cooldown aura. */
export type CooldownName = `icd.aura.${string}`;

/** A trigger's developer id: its aura's name and its index there (`aura.<name>.<index>`, §II.3.11). */
export const triggerName = (aura: string, index: number): string => `aura.${aura}.${index}`;

/** The name of a trigger's internal-cooldown aura: `icd.` and the trigger's id. */
export const cooldownName = (aura: string, index: number): CooldownName => `icd.aura.${aura}.${index}`;

/** How the internal-cooldown auras are built. */
export interface CooldownOptions<G extends TriggerTypes> {
  /**
   * Their pinned order (§II.6 K5): the cooldown auras' own append-only list. A pinned name no trigger derives any
   * more keeps its slot as a tombstone; a derived one not pinned yet is appended after the pinned ones, in aura order
   * then trigger order. Pin the list in a test (`checkOrder`), so a new cooldown never moves another's id.
   */
  readonly order?: readonly string[];

  /** The clock they count on; the aura system's first clock when absent. */
  readonly clock?: G['clock'];

  /** Tags they carry, so a cleanse can reset them (`removeByTag`). */
  readonly tags?: readonly G['tag'][];
}

/** The authored auras with the derived cooldown auras after them, and the order to register them in. */
export interface WithCooldowns<G extends TriggerTypes, Name extends string> {
  /** Every definition: the authored ones, then one per trigger with an `icd`, and tombstones for retired ones. */
  readonly defs: Readonly<Record<Name | CooldownName, AuraDef<G> | Tombstone>>;

  /** The registry order: the authored names in key order, then the cooldown names in their own order. */
  readonly order: readonly string[];
}

/** One derived cooldown aura: the trigger's `icd` long, refreshed on every fire, owner-only. */
const cooldownAura = <G extends TriggerTypes>(icd: number, options: CooldownOptions<G>): AuraDef<G> =>
  defineAura<G>({
    duration: icd,
    stacking: 'refresh',
    ownerOnly: true,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.tags === undefined ? {} : { tags: options.tags }),
  });

/** Every derived cooldown aura, in aura order then trigger order. */
const derive = <G extends TriggerTypes>(
  defs: Readonly<Record<string, AuraDef<G> | Tombstone>>,
  options: CooldownOptions<G>,
): Map<string, AuraDef<G>> => {
  const derived = new Map<string, AuraDef<G>>();

  for (const [name, def] of Object.entries(defs)) {
    const triggers: readonly unknown[] = 'isRetired' in def ? [] : (def.triggers ?? []);

    for (const [index, trigger] of triggers.entries()) {
      // An unsound icd derives nothing: the trigger system refuses the trigger at load, naming it.
      if (isTriggerDef<G>(trigger) && trigger.icd !== undefined && trigger.icd > 0 && Number.isFinite(trigger.icd)) {
        derived.set(cooldownName(name, index), cooldownAura(trigger.icd, options));
      }
    }
  }

  return derived;
};

/**
 * Adds the internal-cooldown auras of every trigger with an `icd` to the authored auras (§II.3.11, §II.6 K5):
 * `const all = withTriggerCooldowns(AUTHORED, { order: ICD_ORDER, tags: ['cooldown'] })`, then
 * `defineAuras(all.defs, { order: all.order })`. Each is `icd.aura.<name>.<index>`, the trigger's `icd` long,
 * `refresh`, owner-only, with the given clock and tags; their ids follow the authored ones, in their own pinned order.
 */
export const withTriggerCooldowns = <G extends TriggerTypes, const Name extends string>(
  defs: Readonly<Record<Name, AuraDef<G> | Tombstone>>,
  options: CooldownOptions<G> = {},
): WithCooldowns<G, Name> => {
  const authored = Object.keys(defs);
  const derived = derive<G>(defs, options);
  const pinned = options.order ?? [];
  const isPinned = new Set(pinned);
  const cooldowns: Record<string, AuraDef<G> | Tombstone> = {};

  for (const name of pinned) {
    if (!name.startsWith('icd.aura.')) {
      throw new RangeError(`Pinned cooldown ${name} is not an internal-cooldown aura name (icd.aura.…).`);
    }

    cooldowns[name] = derived.get(name) ?? TOMBSTONE;
  }

  for (const [name, def] of derived) {
    if (!isPinned.has(name)) {
      cooldowns[name] = def;
    }
  }

  if (authored.some((name) => Object.hasOwn(cooldowns, name))) {
    throw new RangeError('An authored aura is named like an internal-cooldown aura (icd.aura.…).');
  }

  return Object.freeze({
    defs: Object.freeze({ ...defs, ...cooldowns }),
    order: Object.freeze([...authored, ...Object.keys(cooldowns)]),
  });
};
