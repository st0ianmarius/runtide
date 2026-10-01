import type { AuraContext, AuraSystem } from '../auras/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { StatId, StatTable, StatView } from '../modifiers/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { Blow } from './blow.ts';
import type { DamageCues } from './cues.ts';
import type { BlowStop, DamageTypes, RollSlot } from './damage-types.ts';
import type { Death } from './death.ts';
import type { DamageEvents } from './events.ts';
import type { Force } from './force.ts';
import type { Heal } from './heal.ts';
import type { DamageKindTable } from './kinds.ts';
import type { MitigationTable } from './mitigation.ts';
import type { RollTable } from './rolls.ts';
import type { StageDef } from './stage-order.ts';
import type { DamageSystem } from './system.ts';

/** A blow as a stage may change it: its amount, flags and the game's fields. */
export interface BlowState<G extends DamageTypes> extends Blow<G> {
  /** The damage it carries now. */
  amount: number;

  /** Whether it is critical. */
  isCrit: boolean;

  /** The outcome row that decided or changed it. */
  outcome: string | undefined;

  /** The point it comes from. */
  from: Vec2 | undefined;

  /** The game's own fields. */
  ext: G['blowExt'] | undefined;
}

/** A heal as a stage may change it. */
export interface HealState<G extends DamageTypes> extends Heal<G> {
  /** The healing it carries now. */
  amount: number;
}

/** A force as a stage may change it. */
export interface ForceState<G extends DamageTypes> extends Force<G> {
  /** The strength it has now. */
  amount: number;

  /** Its own direction. */
  direction: Vec2 | undefined;
}

/**
 * A game's own damage stage: it reads and changes the blow, and may end it (`ignored`, `blocked`);
 * an after-stage runs for every blow that entered the pipeline and cannot end it. `damage` is the system.
 */
export type DamageStage<G extends DamageTypes> = (blow: BlowState<G>, damage: DamageSystem<G>) => BlowStop | undefined;

/** A game's own heal stage: it reads and changes the heal, and may block it. */
export type HealStage<G extends DamageTypes> = (heal: HealState<G>, damage: DamageSystem<G>) => 'blocked' | undefined;

/** A game's own force stage: it reads and changes the force, and may cancel it (`ignored`). */
export type ForceStage<G extends DamageTypes> = (
  force: ForceState<G>,
  damage: DamageSystem<G>
) => 'ignored' | undefined;

/** One step of the death pipeline's reward slots: the game's own code, such as a loot roll. */
export type DeathStep<G extends DamageTypes> = (death: Death<G>, damage: DamageSystem<G>) => void;

/**
 * The world the pipelines act on, as the game implements it (narrow host interfaces): health, stats, rolls and
 * the rest. Only `health` and `setHealth` are required; each stage that needs more says so when the system is built.
 */
export interface DamageHost<G extends DamageTypes> {
  /** A unit's health now. */
  readonly health: (unit: G['bearer']) => number;

  /**
   * Writes a unit's health. The damage pipeline hands over `before − damage`, which may go below 0 (overkill); a host
   * that keeps health at 0 or above clamps it here.
   */
  readonly setHealth: (unit: G['bearer'], health: number) => void;

  /** A unit's maximum health: the heal cap and `setHealth` shares read it. */
  readonly maxHealth?: (unit: G['bearer']) => number;

  /**
   * A unit's stats for a spell (a blow's or a heal's: folded for the spell, as a scoped modifier needs) or, with none,
   * in general; and against the blow's or heal's other unit when there is one, which the modifiers that ask about it
   * read (`against`, `againstValue`, through the fold read's `against`): the attacker's stats against the target, the
   * target's against the attacker. Outgoing multipliers, crit, block, mitigation, heal stats and scaled values read
   * it, each view at once: it is never kept past the read.
   */
  readonly statsOf?: (unit: G['bearer'], spell: G['spell'] | undefined, against?: G['bearer']) => StatView;

  /**
   * A spell's share of an outgoing multiplier stat (`SpellDef.scaling`), looked up through the blow's source
   * spell; `undefined` (or no host function) is a share of 1, which reads the stat unchanged.
   */
  readonly shareOf?: (spell: G['spell'], stat: StatId) => number | undefined;

  /** A draw in [0, 1) for a roll slot of one blow: the host's stream table decides the stream or the keyed roll. */
  readonly roll?: (slot: RollSlot, blow: Blow<G>) => number;

  /** A unit's entity id, credited as a blow's source when the spec names none. */
  readonly idOf?: (unit: G['bearer']) => number;

  /**
   * The unit an entity id names, if it is still there: the attacker of a damage proc credited to an aura's source (a
   * periodic beat on its victim, credited to its caster). Without it such a blow has no attacker.
   */
  readonly unitOf?: (source: number) => G['bearer'] | undefined;

  /**
   * The proc system, whose depth cap each death rebases (`rebase`, `restoreBase`): what a death sets off through procs
   * (a death burst) nests afresh, so a chain of kills is capped by `maxKillChain`. Deaths share the proc cap when absent.
   */
  readonly procs?: Pick<ProcSystem<G>, 'rebase' | 'restoreBase'>;

  /** Runs procs an aura damage hook returned (`onLethal`, `onDealt`): wire it to `procSystem.runAura`. */
  readonly run?: (procs: readonly G['proc'][], ctx: AuraContext<G>) => void;

  /** Moves a unit by a force that went through the force pipeline: the physics are the game's. */
  readonly applyForce?: (force: Force<G>) => void;

  /** Takes a dead unit out of the world, last in the death pipeline. */
  readonly remove?: (unit: G['bearer'], death: Death<G>) => void;

  /**
   * Whether a unit is out of play whatever its health says (killed outright, despawned): it takes no blow, heal or
   * force, and dies no more. By health alone when absent.
   */
  readonly isGone?: (unit: G['bearer']) => boolean;
}

/** The heal pipeline's stats. */
export interface HealOptions<G extends DamageTypes> {
  /** The target's multiplier stat every heal is multiplied by (healing received). */
  readonly received?: G['stat'];

  /** The healer's multiplier stat every heal it gives is multiplied by (healing done). */
  readonly done?: G['stat'];
}

/** What a damage system is built from: the game's tables and host, and the stages it configures. */
export interface DamageSystemOptions<G extends DamageTypes> {
  /** The aura system whose damage hooks the pipelines call. */
  readonly auras: AuraSystem<G>;

  /** The game's damage kinds. */
  readonly kinds: DamageKindTable<G['damageKind']>;

  /** The host. */
  readonly host: DamageHost<G>;

  /** The game's stat table: needed by every stage that reads a stat. */
  readonly stats?: StatTable<G['stat']>;

  /** The attacker's multiplier stats every blow is multiplied by, in order, each by its spell's share. */
  readonly outgoing?: readonly G['stat'][];

  /**
   * The outcome rows the roll stage rolls (`defineRollTable`): miss, dodge, parry, glancing, block, crit, or
   * the game's own, in `single` or `independent` mode. No rolls when absent.
   */
  readonly rolls?: RollTable;

  /** The mitigation rows, run in order by the mitigation stage. */
  readonly mitigation?: MitigationTable<G['stat'], G['damageKind']>;

  /** The heal pipeline's stats. */
  readonly heal?: HealOptions<G>;

  /** The game's own damage stages, by name, each at its position. */
  readonly stages?: Readonly<Record<string, StageDef<DamageStage<G>>>>;

  /** The game's own heal stages. */
  readonly healStages?: Readonly<Record<string, StageDef<HealStage<G>>>>;

  /** The game's own force stages. */
  readonly forceStages?: Readonly<Record<string, StageDef<ForceStage<G>>>>;

  /** The death pipeline's reward slots: steps before the death event, and after it. */
  readonly death?: {
    /** Before the death event (souls). */
    readonly before?: readonly DeathStep<G>[];

    /** After it (the loot roll). */
    readonly after?: readonly DeathStep<G>[];
  };

  /** The bus and kinds the system raises its events on. */
  readonly events?: DamageEvents<G>;

  /** The game's mapping from outcomes to cues; no cue is fired when absent. */
  readonly cues?: DamageCues<G>;

  /**
   * A game's own roll rule for a slot, in place of the default: no draw at a chance of 0 or less or
   * of 1 or more, one `host.roll` below the chance otherwise.
   */
  readonly rollChance?: (chance: number, slot: RollSlot, blow: Blow<G>) => boolean;

  /** A game's own rule for when health means dead (`health <= 1e-8`); `health <= 0` by default. */
  readonly isDead?: (health: number) => boolean;

  /**
   * How many blows, heals, forces and lethal `setHealth`s may nest (a blow whose trigger deals a blow…); deeper ones
   * are skipped. A death
   * starts the count again for what it sets off, so a chain of kills is held by `maxKillChain` instead. 8 by default.
   */
  readonly maxDepth?: number;

  /**
   * How many deaths may nest, each set off by the one before (a corpse explosion killing the next): what the deepest
   * one sets off is skipped, a lethal `setHealth` as much as a blow. Each death takes a unit, so a chain ends anyway;
   * this keeps the call stack small. 64 by default.
   */
  readonly maxKillChain?: number;
}
