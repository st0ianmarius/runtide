import { type AbilitySystem, NO_LOADOUT } from '../abilities/index.ts';
import { type AiSystem, NO_BRAIN } from '../ai/index.ts';
import type { AuraSystem } from '../auras/index.ts';
import type { Bitset } from '../core/index.ts';
import type { DamageSystem } from '../damage/index.ts';
import type { Vec2 } from '../math/index.ts';
import {
  type Modifier,
  type ModifierList,
  type ModifierSystem,
  plus,
  type SourceId,
  type StatId,
  type StatView,
} from '../modifiers/index.ts';
import type { SpellId, SpellSystem } from '../spells/index.ts';
import type { WorldQuery } from '../world/index.ts';
import type { UnitEvents } from './events.ts';
import type { UnitStateTable } from './states.ts';
import type { UnitRegistry } from './unit-def.ts';
import type { Lifecycle, UnitId, UnitTypes } from './unit-types.ts';
import { Unit } from './unit.ts';

/**
 * What a unit's health does when its maximum health moves (§II.6 M7): `heal-gain-scale-loss` (a gain heals the
 * difference, through the heal pipeline when the system has a damage system; a loss keeps the same share), `scale`
 * (the same share either way), `keep` (health stays, clamped to the new maximum), or the game's own rule, returning
 * the new health.
 */
export type HealthPolicy<G extends UnitTypes> =
  'heal-gain-scale-loss' | 'scale' | 'keep' | ((unit: G['bearer'], before: number, after: number) => number);

/** What a unit system is built from (§I.5). */
export interface UnitSystemBase<G extends UnitTypes> {
  /** The game's unit templates. */
  readonly registry: UnitRegistry<G>;

  /** The aura system every unit bears auras through. */
  readonly auras: AuraSystem<G>;

  /** The spell system every unit casts through. */
  readonly spells: SpellSystem<G>;

  /**
   * The AI system, for units that think (§I.7.1 F17): each unit gets a brain, freed as it despawns, whose timers its
   * states' interrupts hold (`interrupts`). Every unit has the shared empty brain when absent.
   */
  readonly ai?: AiSystem<G>;

  /** The world a summon's point is picked in (`summon`'s `around`); none when absent. */
  readonly world?: Pick<WorldQuery<G['bearer']>, 'positionOf' | 'pickPoint'>;

  /** The ability system, for units with buttons; every unit has an empty loadout when absent. */
  readonly abilities?: AbilitySystem<G>;

  /**
   * The modifier system every unit folds its stats through (§II.6 M9), and the source its per-instance base stats sit
   * at; stats are the snapshotted bases alone when absent.
   */
  readonly modifiers?: {
    /** The modifier system, whose fold's host is the unit. */
    readonly system: ModifierSystem<G['bearer'], G['stat'], G['condition'], G['valueKind'], G['source']>;

    /** The source a unit's base stats (its template's and its spawn's over the table's) are folded at. */
    readonly base: G['source'];
  };

  /** Health: the stat that is a unit's maximum, and what health does when it moves (`heal-gain-scale-loss`). */
  readonly health: {
    /** The maximum health stat. */
    readonly stat: G['stat'];

    /** The policy; `heal-gain-scale-loss` when absent. */
    readonly policy?: HealthPolicy<G>;
  };

  /** The game's derived unit states (`defineUnitStates`); none when absent. */
  readonly states?: UnitStateTable<G['unitState']>;

  /**
   * The interrupt each derived state raises on the unit's casts while it is in it (§I.7.1 F16: `{ stunned: 'stun',
   * frozen: 'freeze' }`), through `syncStates`, which the aura host's `onTagsChanged` calls. None when absent.
   */
  readonly interrupts?: Readonly<Partial<Record<G['unitState'], G['interrupt']>>>;

  /** The aura system's bearer states the lifecycle enters (`removedOn`: going down, dying, leaving). */
  readonly lifecycleStates?: Readonly<Partial<Record<Exclude<Lifecycle, 'standing'>, G['state']>>>;

  /** The damage system a max health gain heals through; set directly when absent. */
  readonly damage?: () => DamageSystem<G>;

  /** The bus and kinds the system raises its events on. */
  readonly events?: UnitEvents<G>;
}

/** The unit system's options: its base, and `createExt` exactly when the game's `unitExt` does not admit `undefined`. */
export type UnitSystemOptions<G extends UnitTypes> = UnitSystemBase<G> &
  (undefined extends G['unitExt']
    ? {
        /** Makes the game's fields of a unit; they stay `undefined` when absent. */
        readonly createExt?: () => G['unitExt'];
      }
    : {
        /** Makes the game's fields of a unit. */
        readonly createExt: () => G['unitExt'];
      });

/** How a unit is spawned. */
export interface SpawnUnit<G extends UnitTypes> {
  /** Its side, 0 or 1. */
  readonly side: number;

  /** The unit it belongs to; none when absent. */
  readonly owner?: G['bearer'];

  /** Its entity id; the system's next when absent. */
  readonly id?: number;

  /** Its own base stats, over its template's (a mob keeping its spawn wave's numbers). */
  readonly stats?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Where it stands, handed to the `spawned` event for the game's world; none when absent. */
  readonly at?: Vec2;

  /** Whether it despawns (reason `owner`) as its owner dies or despawns (§I.7.1 F18); false when absent. */
  readonly isBound?: boolean;
}

/** A stat view of a unit's own snapshotted bases, for a game without a modifier system. */
class BaseView implements StatView {
  readonly #base: Float64Array;

  constructor(base: Float64Array) {
    this.#base = base;
  }

  total(stat: StatId): number {
    return this.#base[stat] ?? 0;
  }

  base(stat: StatId): number {
    return this.#base[stat] ?? 0;
  }
}

/** A derived state that raises an interrupt: its aura tags and the interrupt. */
export interface InterruptingState<G extends UnitTypes> {
  /** Its aura tags. */
  readonly tags: Bitset;

  /** The interrupt it raises. */
  readonly reason: G['interrupt'];
}

/** The most states that may raise interrupts: each is a bit of a unit's `interrupts`. */
const MAX_INTERRUPTING = 31;

/** The states that raise interrupts, resolved against the state table. Throws for a state it does not have. */
const interruptingOf = <G extends UnitTypes>(options: UnitSystemOptions<G>): readonly InterruptingState<G>[] => {
  const map: Readonly<Record<string, G['interrupt'] | undefined>> = options.interrupts ?? {};
  const tags: Readonly<Record<string, Bitset | undefined>> = options.states?.tags ?? {};

  const list = Object.keys(map).flatMap((state) => {
    const reason = map[state];
    const bits = tags[state] ?? missing(`the interrupting state ${state} is not a unit state`);

    return reason === undefined ? [] : [{ tags: bits, reason }];
  });

  if (list.length > MAX_INTERRUPTING) {
    throw new RangeError(`At most ${MAX_INTERRUPTING} unit states may raise interrupts; got ${list.length}.`);
  }

  return Object.freeze(list);
};

/** The unit system's state: its parts, the live units by entity id, the next id, and each template's auto-attack. */
export class UnitEngine<G extends UnitTypes> {
  readonly options: UnitSystemOptions<G>;
  readonly registry: UnitRegistry<G>;

  /** The live units by entity id (despawned ones leave it). */
  readonly byId = new Map<number, G['bearer']>();

  /** The maximum health stat's id. */
  readonly healthStat: StatId;

  /** Each template's auto-attack spell, or `undefined`. */
  readonly autoAttacks: readonly (SpellId | undefined)[];

  /** The states that raise interrupts, in declared order: each one's aura tags and its interrupt. */
  readonly interrupting: readonly InterruptingState<G>[];

  nextId = 1;

  readonly #createExt: () => G['unitExt'];

  /** Each template's compiled base list, shared by every unit spawned with its template's stats alone. */
  readonly #templateLists: (ModifierList | undefined)[] = [];

  constructor(options: UnitSystemOptions<G>) {
    const { registry } = options;
    const spellIds: Readonly<Record<string, SpellId | undefined>> = options.spells.registry.id;

    this.options = options;
    this.registry = registry;
    this.#createExt = extFactory(options);
    this.healthStat =
      registry.stats.index.idOf(options.health.stat) ??
      missing(`the health stat ${options.health.stat} is not in the stat table`);

    this.interrupting = interruptingOf(options);
    this.autoAttacks = registry.ids.map((id) => {
      const name = registry.defs[id]?.autoAttack;

      return name === undefined
        ? undefined
        : (spellIds[name] ?? missing(`unit ${registry.name(id)}'s auto-attack ${name} is not a spell`));
    });
  }

  /** A new unit of a template, standing at full health, with its own stats snapshotted. */
  create(template: UnitId, spawn: SpawnUnit<G>): G['bearer'] {
    const { options, registry } = this;
    const base = this.#baseFor(template, spawn);
    const id = this.#idFor(spawn);

    const unit = new Unit<G>({
      id,
      template,
      side: spawn.side,
      owner: spawn.owner,
      isBound: spawn.isBound === true && spawn.owner !== undefined,
      base,
      tags: registry.tagSets[template]?.clone() ?? missing('a template lost its tags'),
      auras: options.auras.createState(),
      casts: options.spells.createCasterState(),
      loadout: options.abilities?.createLoadout() ?? NO_LOADOUT,
      brain: options.ai?.createBrain() ?? NO_BRAIN,
      sheet: options.modifiers?.system.createSheet(),
      ext: this.#createExt(),
    });

    if (!isBearer<G>(unit)) {
      return missing("a unit is not the game's bearer");
    }

    const made = unit;

    this.foldBases(made, [unit, spawn.stats === undefined]);
    unit.maxHealth = this.statsOf(made).total(this.healthStat);
    unit.health = unit.maxHealth;
    this.byId.set(id, made);

    return made;
  }

  /** A spawn's base stats: its template's, with the spawn's own on top. */
  #baseFor(template: UnitId, spawn: SpawnUnit<G>): Float64Array {
    const { stats } = this.registry;
    const base = Float64Array.from(this.registry.bases[template] ?? stats.columns.base);

    for (const [stat, value] of Object.entries<number | undefined>(spawn.stats ?? {})) {
      const id = stats.index.idOf(stat) ?? missing(`there is no stat named ${stat}`);

      base[id] = value ?? base[id] ?? 0;
    }

    return base;
  }

  /** A spawn's entity id: its own, or the next; refuses one already live. */
  #idFor(spawn: SpawnUnit<G>): number {
    const id = spawn.id ?? this.nextId;

    if (this.byId.has(id)) {
      missing(`entity id ${id} is already a live unit`);
    }

    this.nextId = Math.max(this.nextId, id + 1);

    return id;
  }

  /** Puts a unit's own bases, over the stat table's, at the base source of its sheet. */
  foldBases(bearer: G['bearer'], [unit, isTemplate]: readonly [Unit<G>, boolean]): void {
    const modifiers = this.options.modifiers;
    const { sheet } = unit;

    if (modifiers === undefined || sheet === undefined) {
      unit.view = new BaseView(unit.base);

      return;
    }

    const { system } = modifiers;
    const sources: Readonly<Record<string, SourceId | undefined>> = system.sources.id;
    const source = sources[modifiers.base] ?? missing(`there is no modifier source named ${modifiers.base}`);
    const shared = isTemplate ? this.#templateLists[unit.template] : undefined;
    const list = shared ?? system.compile(this.#baseModifiers(unit.base));

    if (isTemplate) {
      this.#templateLists[unit.template] = list;
    }

    system.setSource(sheet, source, [list]);
    unit.view = system.view(sheet, { host: bearer });
  }

  /** The adds that move the stat table's bases to a unit's own. */
  #baseModifiers(base: Float64Array): Modifier<G['stat'], G['condition'], G['valueKind']>[] {
    const tableBase = this.registry.stats.columns.base;
    const names: readonly G['stat'][] = this.registry.stats.names.filter((name): name is G['stat'] => name.length >= 0);

    return [...base].flatMap((value, stat) => {
      const delta = value - (tableBase[stat] ?? 0);
      const name = names[stat];

      return delta === 0 || name === undefined ? [] : [plus(name, delta)];
    });
  }

  /** A unit's stats. */
  statsOf(bearer: G['bearer']): StatView {
    return unitOf(bearer).view ?? missing('a unit lost its stat view');
  }
}

/** A unit record from its bearer, or a clear error for a bearer the unit system did not make. */
export const unitOf = <G extends UnitTypes>(bearer: G['bearer']): Unit<G> => {
  if (!isUnit<G>(bearer)) {
    throw new TypeError('A unit must be made by units.spawn().');
  }

  return bearer;
};

/** Whether a bearer is a unit the system made. */
const isUnit = <G extends UnitTypes>(bearer: G['bearer']): bearer is G['bearer'] & Unit<G> => bearer instanceof Unit;

/** Whether a unit record is the game's bearer: always, since a game's `bearer` is the system's `Unit`. */
const isBearer = <G extends UnitTypes>(unit: Unit<G>): unit is Unit<G> & G['bearer'] => unit instanceof Unit;

/** Whether `undefined` is the game's `unitExt`: true exactly when the options could leave `createExt` out. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isNoExt = <G extends UnitTypes>(value: undefined): value is undefined & G['unitExt'] => value === undefined;

/** The options' `createExt`, or a factory of `undefined` for a game whose `unitExt` admits it. */
const extFactory = <G extends UnitTypes>(options: UnitSystemOptions<G>): (() => G['unitExt']) => {
  const create: (() => G['unitExt']) | undefined = options.createExt;

  return (
    create ??
    ((): G['unitExt'] => {
      const none = undefined;

      if (!isNoExt<G>(none)) {
        throw new TypeError('This unit system needs createExt.');
      }

      return none;
    })
  );
};

/** Throws a `RangeError` for a unit system problem. */
const missing = (problem: string): never => {
  throw new RangeError(`Unit system: ${problem}.`);
};
