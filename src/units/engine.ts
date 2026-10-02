import { type AbilitySystem, NO_LOADOUT } from '../abilities/index.ts';
import { type AiSystem, NO_BRAIN } from '../ai/index.ts';
import type { AuraSystem } from '../auras/index.ts';
import { ownValue } from '../core/records.ts';
import type { Vec2 } from '../math/index.ts';
import { basesView, type ModifierSystem, type StatId, type StatView } from '../modifiers/index.ts';
import type { SpellId, SpellSystem } from '../spells/index.ts';
import { UnitBases, type UnitVariant } from './bases.ts';
import type { UnitEvents } from './events.ts';
import type { InterruptingState, UnitStateTable } from './states.ts';
import type { UnitRegistry } from './unit-def.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';
import { Unit } from './unit.ts';

/**
 * What a unit's health does when its maximum health moves: `scale` (the same share), `keep` (health stays, clamped to
 * the new maximum), or the game's own rule, returning the new health (a gain healed through its heal pipeline).
 */
export type HealthPolicy<G extends UnitTypes> =
  | 'scale'
  | 'keep'
  | ((unit: G['bearer'], before: number, after: number) => number);

/** What a unit system is built from. */
export interface UnitSystemBase<G extends UnitTypes> {
  /** The game's unit templates. */
  readonly registry: UnitRegistry<G>;

  /** The aura system every unit bears auras through. */
  readonly auras: AuraSystem<G>;

  /**
   * Whether a spawn may happen (a crowd cap, a refused placement), asked by `units.trySpawn` and the `summon` proc
   * before anything is made: false refuses it, making no unit, taking no id and raising nothing. `units.spawn` never
   * asks (a hero, a boss, a group the cap does not count). Every spawn may when absent.
   */
  readonly admit?: (template: UnitId, spawn: SpawnUnit<G>) => boolean;

  /** The spell system every unit casts through. */
  readonly spells: SpellSystem<G>;

  /**
   * The AI system, for units that think: each unit gets a brain, freed as it despawns, whose timers its
   * states' interrupts hold (`interrupts`). Every unit has the shared empty brain when absent.
   */
  readonly ai?: AiSystem<G>;

  /**
   * The script system's side (`scripts.forUnits`), or a function giving it, since the script system is made after the
   * unit system: a unit whose template names a script is attached to it once spawned and detached once
   * despawned. Required when any template names a script.
   */
  readonly scripts?: UnitScripts<G> | (() => UnitScripts<G>);

  /** The ability system, for units with buttons; every unit has an empty loadout when absent. */
  readonly abilities?: AbilitySystem<G>;

  /**
   * The modifier system every unit folds its stats through, from its own base stats (its template's and its spawn's
   * over the table's, `setBases`); stats are the snapshotted bases alone when absent.
   */
  readonly modifiers?: {
    /** The modifier system, whose fold's host is the unit. */
    readonly system: ModifierSystem<G['bearer'], G['stat'], G['condition'], G['valueKind'], G['source']>;
  };

  /** Health: the stat that is a unit's maximum, and what health does when it moves (`scale`). */
  readonly health: {
    /** The maximum health stat. */
    readonly stat: G['stat'];

    /** The policy; `scale` when absent. */
    readonly policy?: HealthPolicy<G>;
  };

  /** The game's derived unit states (`defineUnitStates`), with the interrupts they raise; none when absent. */
  readonly states?: UnitStateTable<G['unitState'], G['interrupt']>;

  /** The bus and kinds the system raises its events on. */
  readonly events?: UnitEvents<G>;

  /**
   * Allocates a unit's entity id from the game's shared counter (`createEntityIds().next`), so units, area triggers
   * and casts share one id space. Without it the system counts its own ids from 1.
   */
  readonly allocateId?: () => number;
}

/** Makes the game's fields of a new unit: its template tells a mob from a hero, its spawn holds what it was given. */
export type UnitExtFactory<G extends UnitTypes> = (template: UnitId, spawn: SpawnUnit<G>) => G['unitExt'];

/** The unit system's options: its base, and `createExt` exactly when the game's `unitExt` does not admit `undefined`. */
export type UnitSystemOptions<G extends UnitTypes> = UnitSystemBase<G> &
  (undefined extends G['unitExt']
    ? {
        /** Makes the game's fields of a unit, from its template and its spawn; they stay `undefined` when absent. */
        readonly createExt?: UnitExtFactory<G>;
      }
    : {
        /** Makes the game's fields of a unit, from its template and its spawn (a mob's record, a hero's). */
        readonly createExt: UnitExtFactory<G>;
      });

/** What the unit system asks of the script system (`createScriptSystem` makes one). */
export interface UnitScripts<G extends UnitTypes> {
  /** Attaches a spawned unit to its template's script, making its record; returns the record's slot. */
  readonly attach: (unit: G['bearer'], script: G['scriptName']) => number;

  /** Runs an attached unit's `spawn` handlers, once its slot is set. */
  readonly start: (unit: G['bearer']) => void;

  /** Detaches a despawned unit: its record is freed. */
  readonly detach: (unit: G['bearer']) => void;

  /** An attached unit died: its script stops (no step, no bound events) and runs its `died` handlers. */
  readonly died: (unit: G['bearer']) => void;

  /** An attached unit was revived: its script runs its `revived` handlers and goes on as it was. */
  readonly revived: (unit: G['bearer']) => void;
}

/** How a unit is spawned. */
export interface SpawnUnit<G extends UnitTypes> {
  /** Its side, a whole number from 0, which the world's reaction rule reads (hostile, neutral or friendly). */
  readonly side: number;

  /** The unit it belongs to; none when absent. */
  readonly owner?: G['bearer'];

  /**
   * Its entity id, a whole number from 0; the system's next when absent. With `allocateId`, an id given here must come
   * from that counter (an id the server handed out), which is never told of it and could hand it out again.
   */
  readonly id?: number;

  /** Its own base stats, over its template's (a one-off: a horde's shared numbers are a `variant`). */
  readonly stats?: Readonly<Partial<Record<G['stat'], number>>>;

  /**
   * Its template's variant (`units.variant`): base stats compiled once and shared by every unit spawned with it (a
   * wave's scaled mobs, a level's elites), in place of `stats`.
   */
  readonly variant?: UnitVariant;

  /** Where it stands, handed to the `spawned` event for the game's world; none when absent. */
  readonly at?: Vec2;

  /** Whether it despawns (reason `owner`) as its owner dies or despawns; false when absent. */
  readonly isBound?: boolean;

  /** The game's own data for this spawn (a wave index, a summoner), handed to `createExt` and `admit`. */
  readonly data?: G['spawnData'];

  /**
   * The script it runs, in place of its template's: one bodiless template serves every world script,
   * `units.spawn(WORLD, { side: 1, script: 'inferno' })`. Its template's when absent.
   */
  readonly script?: G['scriptName'];
}

/** A dependency given as itself or as a function giving it (made after the system that needs it). */
export const lateOf = <T extends object>(value: T | (() => T)): T => (typeof value === 'function' ? value() : value);

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
  readonly interrupting: readonly InterruptingState<G['interrupt']>[];

  /** Summon slots reserved while replacement callbacks run. */
  readonly admittingOwners: G['bearer'][] = [];
  readonly admittingTemplates: UnitId[] = [];
  nextId = 1;

  readonly #createExt: UnitExtFactory<G>;

  /** The units' base stats: each template's, and the variants'. */
  readonly bases: UnitBases<G>;

  constructor(options: UnitSystemOptions<G>) {
    const { registry } = options;
    const spellIds: Readonly<Record<string, SpellId | undefined>> = options.spells.registry.id;

    this.options = options;
    this.registry = registry;
    this.#createExt = extFactory(options);
    this.bases = new UnitBases(options);
    this.healthStat =
      registry.stats.index.idOf(options.health.stat) ??
      missing(`the health stat ${options.health.stat} is not in the stat table`);

    this.interrupting = options.states?.interrupting ?? [];
    this.autoAttacks = registry.ids.map((id) => {
      const name = registry.defs[id]?.autoAttack;

      return name === undefined
        ? undefined
        : (ownValue(spellIds, name) ?? missing(`unit ${registry.name(id)}'s auto-attack ${name} is not a spell`));
    });
  }

  /** A new unit of a template, alive at full health, with its own stats snapshotted. */
  create(template: UnitId, spawn: SpawnUnit<G>): G['bearer'] {
    const { options, registry } = this;
    const base = this.bases.baseOf(template, spawn);
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
      ext: this.#createExt(template, spawn)
    });

    if (!isBearer<G>(unit)) {
      return missing("a unit is not the game's bearer");
    }

    const made = unit;

    const autoAttack = this.autoAttacks[template];

    if (autoAttack !== undefined) {
      options.spells.arm(made, autoAttack);
    }

    this.foldBases(made, unit);
    unit.maxHealth = this.statsOf(made).total(this.healthStat);
    unit.health = unit.maxHealth;
    this.byId.set(id, made);

    return made;
  }

  /** A spawn's entity id: its own, or the next; refuses one already live. */
  #idFor(spawn: SpawnUnit<G>): number {
    const id = spawn.id ?? this.options.allocateId?.() ?? this.nextId;

    if (!Number.isSafeInteger(id) || id < 0) {
      throw new RangeError(`A unit's entity id is a whole number from 0; got ${id}.`);
    }

    if (this.byId.has(id)) {
      missing(`entity id ${id} is already a live unit`);
    }

    this.nextId = Math.max(this.nextId, id + 1);

    return id;
  }

  /** Starts a unit's sheet from its own bases, and makes its stat view. */
  foldBases(bearer: G['bearer'], unit: Unit<G>): void {
    const modifiers = this.options.modifiers;
    const { sheet } = unit;

    if (modifiers === undefined || sheet === undefined) {
      unit.view = basesView(unit.base);

      return;
    }

    modifiers.system.setBases(sheet, unit.base);
    unit.view = modifiers.system.view(sheet, { host: bearer });
    unit.againstRead = undefined;
    unit.againstView = undefined;
  }

  /**
   * A unit's stats, against another unit when one is named (a blow's other side): the same view each time, the other
   * unit set on its read, so it is read at once and not kept.
   */
  statsOf(bearer: G['bearer'], against?: G['bearer']): StatView {
    const unit = unitOf(bearer);
    const view = unit.view ?? missing('a unit lost its stat view');
    const { sheet } = unit;
    const system = this.options.modifiers?.system;

    if (against === undefined || sheet === undefined || system === undefined) {
      return view;
    }

    const read = (unit.againstRead ??= { host: bearer, against });

    read.against = against;

    return (unit.againstView ??= system.view(sheet, read));
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
const extFactory = <G extends UnitTypes>(options: UnitSystemOptions<G>): UnitExtFactory<G> => {
  const create: UnitExtFactory<G> | undefined = options.createExt;

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
