import type { AuraSystem } from '../auras/index.ts';
import type { StatId, StatView } from '../modifiers/index.ts';
import type { CastOptions, SpellId, SpellSystem } from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';
import { compileButtons, type CompiledButton } from './buttons.ts';
import type { SlotTable } from './slots.ts';

/** The options a button casts with, reused: the cast order reads them before any hook runs. */
class PressOptions<G extends AbilityTypes> implements CastOptions<G> {
  input: G['input'] | undefined = undefined;
  rank = 1;
}

/** A stat view of a stat table's bases: what a cooldown reads with no stats host, and in a preview. */
class BaseView implements StatView {
  readonly #bases: ArrayLike<number>;

  constructor(bases: ArrayLike<number>) {
    this.#bases = bases;
  }

  total(stat: StatId): number {
    return this.#bases[stat] ?? 0;
  }

  base(stat: StatId): number {
    return this.#bases[stat] ?? 0;
  }
}

/** What an ability system is built from: the spell and aura systems, the slots, and the caster's stats. */
export interface AbilityParts<G extends AbilityTypes> {
  /** The spell system its abilities cast through. */
  readonly spells: SpellSystem<G>;

  /** The aura system its cooldowns, costs and states live in. */
  readonly auras: AuraSystem<G>;

  /** The game's slots. */
  readonly slots: SlotTable<G['slot']>;

  /** The caster's stats for one spell, which a scaled cooldown and a scaled `applies` read; the bases when absent. */
  readonly statsOf?: ((caster: G['bearer'], spell: SpellId) => StatView | undefined) | undefined;
}

/** The ability system's state: its parts, every button compiled, each slot's cooldown aura, and reused scratch. */
export class AbilityEngine<G extends AbilityTypes> {
  readonly spells: SpellSystem<G>;
  readonly auras: AuraSystem<G>;
  readonly slots: SlotTable<G['slot']>;

  /** Every button spell's activation, compiled, by spell id. */
  readonly buttons: readonly (CompiledButton<G> | undefined)[];

  /** Each slot's cooldown aura, −1 for none. */
  readonly cooldowns: Int32Array;

  /** The view of the stat table's bases. */
  readonly baseView: StatView;

  /** The reused cast options. */
  readonly options = new PressOptions<G>();

  /** The input of the press being fired, read at once by each slot's firing. */
  input: G['input'] | undefined = undefined;

  readonly #statsOf: AbilityParts<G>['statsOf'];

  constructor(parts: AbilityParts<G>) {
    this.spells = parts.spells;
    this.auras = parts.auras;
    this.slots = parts.slots;
    this.buttons = compileButtons(parts.spells.registry, parts.auras);
    this.cooldowns = Int32Array.from(parts.slots.ids, (slot) => parts.slots.get(slot).cooldown ?? -1);
    this.baseView = new BaseView(parts.spells.registry.stats?.columns.base ?? []);
    this.#statsOf = parts.statsOf;

    for (const slot of parts.slots.ids) {
      const aura = parts.slots.get(slot).cooldown;
      const { registry } = parts.auras;

      if (aura !== undefined && (!(aura >= 0 && aura < registry.size) || registry.isRetired(aura))) {
        throw new RangeError(`Slot ${parts.slots.name(slot)}: its cooldown ${aura} is not a live aura.`);
      }
    }
  }

  /** A caster's stats for one spell; the bases for no caster (a preview) or no stats host. */
  viewOf(caster: G['bearer'] | undefined, spell: SpellId): StatView {
    return (caster === undefined ? undefined : this.#statsOf?.(caster, spell)) ?? this.baseView;
  }
}
