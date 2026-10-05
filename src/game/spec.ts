import type { AbilitySystemOptions } from '../abilities/index.ts';
import type { AiProcKinds, AiSystemOptions } from '../ai/index.ts';
import type {
  AreaTriggerHost,
  AreaTriggerProcKinds,
  AreaTriggerSystemBase,
  AreaTriggerTypes
} from '../area-triggers/index.ts';
import type { AuraHost, AuraSystemBase } from '../auras/index.ts';
import type { CombatLogOptions } from '../combat-log/index.ts';
import type { Bitset, EntityIds, EventKind, SimClock, StreamTable } from '../core/index.ts';
import type { Blow, DamageHost, DamageProcKinds, DamageSystemOptions, Force } from '../damage/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { ModifierSystemOptions } from '../modifiers/index.ts';
import type { Proc, ProcHost, ProcRegistry, ProcSystemOptions } from '../procs/index.ts';
import type { ScriptSystemOptions, ScriptTypes } from '../scripts/index.ts';
import type { SpellHost, SpellProcKinds, SpellSystemBase } from '../spells/index.ts';
import type { UnitExtFactory, UnitProcKinds, UnitSystemBase } from '../units/index.ts';
import type { MemoryWorldOptions, WorldQuery } from '../world/index.ts';

/**
 * The types a whole game is written against: units with scripts (and through them abilities, spells, auras, damage,
 * AI and procs) and area triggers. A game without area triggers declares their names `never`.
 */
export type GameTypes = ScriptTypes & AreaTriggerTypes;

/**
 * The framework's records a game's types point at, as every game declares them (`proc: Proc<Game>`, `blow:
 * Blow<Game>`, `force: Force<Game>`): `createGame` hands one system's procs and blows to another.
 */
export interface GameRecords<G extends GameTypes> {
  /** The game's procs: the framework's over its types. */
  readonly proc: Proc<G>;

  /** The framework's blow. */
  readonly blow: Blow<G>;

  /** The framework's force. */
  readonly force: Force<G>;
}

/** The bus `createGame` hears unit events on to keep a memory world in step (a core `Bus` is one). */
export interface GameBus {
  /** Adds a subscriber; returns the function that removes it. */
  readonly on: <Payload>(kind: EventKind<Payload>, subscriber: (payload: Payload) => void) => () => void;
}

/** Where a spawned unit's body stands in a memory world, and its radius. */
export interface WorldBody {
  /** Where it stands. */
  readonly at: Vec2;

  /** Its body radius; 0 when absent. */
  readonly radius?: number;
}

/**
 * The world: a memory world `createGame` builds and keeps in step with the units (a spawn adds a body, a despawn
 * removes it, a side change moves it), or the game's own `WorldQuery`, which the game keeps in step itself.
 */
export type GameWorldSpec<G extends GameTypes> =
  | {
      /** The memory world's options; its `idOf` is the unit's entity id when absent. */
      readonly memory: MemoryWorldOptions<G['bearer']>;

      /**
       * The body a spawned unit gets (read once, at its `spawned` event, with the point its spawn named), or
       * `undefined` for a bodiless unit (a world script's). A unit spawned at a point gets a body of radius 0 there, and
       * one spawned at none is bodiless, when absent.
       */
      readonly bodyOf?: (unit: G['bearer'], at: Vec2 | undefined) => WorldBody | undefined;
    }
  | {
      /** The game's own world. */
      readonly query: WorldQuery<G['bearer']>;

      /** Folds the game's world into a digest, for `game.digest`; the world is left out of it when absent. */
      readonly digest?: (hash: number) => number;
    };

/** The aura system's options but its modifier system (`GameSpec.modifiers`) and the host members `createGame` binds. */
export type GameAurasSpec<G extends GameTypes> = Omit<AuraSystemBase<G>, 'host' | 'modifiers'> & {
  /** The game's own aura host members; `run` (the proc system's) and `onTagsChanged` (the units') are bound. */
  readonly host?: Omit<AuraHost<G>, 'run' | 'onTagsChanged'>;

  /** Makes the game's fields of a pooled aura; they stay `undefined` when absent (a game whose `ext` admits it). */
  readonly createExt?: () => G['ext'];
};

/** The spell system's options but the systems and clock `createGame` hands it, and the host members it binds. */
export type GameSpellsSpec<G extends GameTypes> = Omit<SpellSystemBase<G>, 'auras' | 'procs' | 'clock' | 'host'> & {
  /**
   * The game's own spell host: `canAct`, `statsOf` and `isGone` are the unit system's (`units.hosts.spell`); `idOf` (a
   * cast cue's owner, a cast's credit) is the unit's entity id when absent.
   */
  readonly host: Omit<SpellHost<G>, 'canAct' | 'statsOf' | 'isGone'> & G['host'];

  /** Makes the game's fields of a pooled cast; they stay `undefined` when absent (a game whose `castExt` admits it). */
  readonly createExt?: () => G['castExt'];
};

/** The area trigger system's options but the systems, world and clock `createGame` hands it, and its bound host members. */
export type GameAreasSpec<G extends GameTypes> = Omit<
  AreaTriggerSystemBase<G>,
  'spells' | 'auras' | 'procs' | 'world' | 'clock' | 'host'
> & {
  /**
   * The game's own area host: `isGone` is the units' (`units.hosts.area`), `allocateId` the shared id space's; `idOf` is
   * the unit's entity id and `sideOf` the unit's own side when absent, so a unit with no body in the world (a world
   * script's director) may own area triggers.
   */
  readonly host: Omit<AreaTriggerHost<G>, 'isGone' | 'allocateId'> & G['host'];

  /** Makes the game's fields of a pooled area trigger; `undefined` when absent (a game whose `areaExt` admits it). */
  readonly createExt?: () => G['areaExt'];
};

/**
 * The unit system's options but the systems `createGame` hands it and the shared id space's `allocateId`. Its
 * `health.onLethal` is the damage system's `kill` when absent.
 */
export type GameUnitsSpec<G extends GameTypes> = Omit<
  UnitSystemBase<G>,
  'auras' | 'spells' | 'ai' | 'scripts' | 'abilities' | 'areaTriggers' | 'modifiers' | 'allocateId'
> & {
  /** A damage spell's modifier scopes (`modifiers.scopeOf`); numeric spell ids use the spell registry's tags when absent. */
  readonly scopeOf?: (spell: G['spell']) => Bitset | undefined;

  /** Makes the game's fields of a unit; they stay `undefined` when absent (a game whose `unitExt` admits it). */
  readonly createExt?: UnitExtFactory<G>;
};

/** The damage host members the unit system provides (`units.damageHost`), which `createGame` spreads in. */
export type UnitDamageMember =
  | 'health'
  | 'setHealth'
  | 'maxHealth'
  | 'statsOf'
  | 'idOf'
  | 'unitOf'
  | 'remove'
  | 'isGone';

/** The damage system's options but its aura system and the host members `createGame` binds. */
export type GameDamageSpec<G extends GameTypes> = Omit<DamageSystemOptions<G>, 'auras' | 'host'> & {
  /**
   * The game's own damage host members (`applyForce`, `roll`, `shareOf`, `creditOf`): the units' (`units.damageHost`)
   * and `run` and `procs` (the proc system's) are bound.
   */
  readonly host?: Omit<DamageHost<G>, UnitDamageMember | 'run' | 'procs'>;
};

/** Every system's proc kinds, for the game's proc registry. */
export interface GameProcKinds<G extends GameTypes> {
  /** The damage system's. */
  readonly damage: DamageProcKinds<G>;

  /** The spell system's. */
  readonly spells: SpellProcKinds<G>;

  /** The unit system's. */
  readonly units: UnitProcKinds<G>;

  /** The AI system's. */
  readonly ai: AiProcKinds<G>;

  /** The area trigger system's; `undefined` in a game without one (a game with one spreads `k.areas ?? missing()`). */
  readonly areas: AreaTriggerProcKinds<G> | undefined;
}

/** The proc system's options but its aura system, with its registry made over every system's kinds. */
export type GameProcsSpec<G extends GameTypes> = Omit<ProcSystemOptions<G>, 'kinds' | 'auras' | 'host'> & {
  /**
   * Makes the proc registry over every system's kinds: `(k) => createProcRegistry<Game>({ ...CORE_PROCS, ...k.damage,
   * ...k.spells, ...k.units, ...k.ai, ...GAME_PROCS })`, with `...(k.areas ?? missing())` in a game with area triggers.
   * `createGame` checks the registry holds every system's kinds.
   */
  readonly kinds: (kinds: GameProcKinds<G>) => ProcRegistry<G>;

  /** The game's own proc host: `idOf` (the unit's entity id) and `unitOf` (`units.byId`) are bound. */
  readonly host: Omit<ProcHost<G>, 'idOf' | 'unitOf'> & G['host'];
};

/**
 * What `createGame` builds a game from: each system's own options, less what one system hands another, which
 * `createGame` wires in the order the systems need (modifiers, auras, spells, AI, abilities, world, area triggers,
 * units, damage, procs, scripts, combat log).
 */
export interface GameSpec<G extends GameTypes> {
  /** The fixed-step clock spells, AI, area triggers, abilities and the combat log count on; the game steps it. */
  readonly clock: SimClock;

  /** The entity id space units and area triggers draw from; a new one when absent. */
  readonly ids?: EntityIds;

  /** The bus unit events are heard on to keep a memory world in step; required with a memory world. */
  readonly bus?: GameBus;

  /** The modifier system's options: auras fold into it and units fold their stats through it; none when absent. */
  readonly modifiers?: ModifierSystemOptions<G['bearer'], G['stat'], G['condition'], G['valueKind'], G['source']>;

  /** The aura system's. */
  readonly auras: GameAurasSpec<G>;

  /** The spell system's. */
  readonly spells: GameSpellsSpec<G>;

  /** The AI system's, but its spell system and clock. */
  readonly ai: Omit<AiSystemOptions<G>, 'spells' | 'clock'>;

  /** The ability system's, but its spell and aura systems and clock; its `statsOf` is the units' when absent. */
  readonly abilities?: Omit<AbilitySystemOptions<G>, 'spells' | 'auras' | 'clock'>;

  /** The world; none when absent (a game whose units have no bodies to query). Area triggers need one. */
  readonly world?: GameWorldSpec<G>;

  /** The area trigger system's; none when absent. */
  readonly areas?: GameAreasSpec<G>;

  /** The unit system's. */
  readonly units: GameUnitsSpec<G>;

  /** The damage system's. */
  readonly damage: GameDamageSpec<G>;

  /** The proc system's. */
  readonly procs: GameProcsSpec<G>;

  /** The script system's, but its AI and proc systems; none when absent (the game steps `ai.step` instead). */
  readonly scripts?: Omit<ScriptSystemOptions<G>, 'ai' | 'procs'>;

  /** The combat log's, but its clock and ids (the unit's entity id); none when absent. */
  readonly combatLog?: Omit<CombatLogOptions<G['bearer'], G['spell']>, 'clock' | 'idOf'>;

  /** The game's stream table, whose saved states `game.digest` folds; left out of it when absent. */
  readonly streams?: Pick<StreamTable<G['stream']>, 'save'>;
}
