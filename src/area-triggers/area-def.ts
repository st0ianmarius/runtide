import type { AuraId } from '../auras/index.ts';
import type { Random, TickSlotId } from '../core/index.ts';
import type { CueSpec } from '../cues/index.ts';
import type { Shape, Vec2 } from '../math/index.ts';
import type { ScaledSnapshot } from '../modifiers/index.ts';
import type { Proc, ProcOutcome } from '../procs/index.ts';
import type { ProcOut, ProcReturn, SpellContext } from '../spells/index.ts';
import type { WorldQuery } from '../world/index.ts';
import type { AreaTriggerHost } from './area-host.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import type {
  AreaAura,
  AreaCatch,
  AreaContact,
  AreaHit,
  AreaLedger,
  AreaLedgerSpec,
  AreaPhase,
  AreaPulse
} from './delivery-def.ts';
import type { AreaTriggerHandle } from './ids.ts';
import type { AreaQueries } from './queries.ts';
import type { AreaReplication } from './replication.ts';

/**
 * Why an area trigger ended: `expired` (its lifetime ran out), `spent` (its hit budget ran out), `self` (a
 * hook despawned it), `bound` (a bound condition failed), `replaced` (a newer one took its place under the limit),
 * `source-gone` (its owner left the world), or one of the game's own, which it despawned it with.
 */
export type EndReason<G extends AreaTriggerTypes = AreaTriggerTypes> =
  | 'expired'
  | 'spent'
  | 'self'
  | 'bound'
  | 'replaced'
  | 'source-gone'
  | G['endReason'];

/**
 * A function of an area trigger, declared as a method so a function over a narrower state still fits a registry of
 * any state.
 */
export type AreaFn<G extends AreaTriggerTypes, State, Result> = {
  /** The function. */
  bivarianceHack(this: void, c: AreaTriggerContext<G, State>): Result;
}['bivarianceHack'];

/** A position a hook may move: an area trigger's own. */
export interface Position {
  /** The across coordinate. */
  x: number;

  /** The forward coordinate. */
  z: number;
}

/**
 * What every area trigger hook receives: the area trigger itself, pooled, so a hook reads it while it runs
 * and never keeps it (it keeps the handle instead). Its credit and stats are its cast's, captured at the spawn; its own
 * motion (`position`, `heading`) and its `state` are its hooks' to change. Its functions may be called detached.
 */
export interface AreaTriggerContext<G extends AreaTriggerTypes, State = unknown> {
  /** Its handle, which stays valid until it ends. */
  readonly handle: AreaTriggerHandle;

  /** Its entity id, allocated as it enters, before `lifetime` and `init` read it; −1 while a limit's `perOwner` reads it. */
  readonly id: number;

  /** Its kind. */
  readonly kind: AreaTriggerId;

  /** Who spawned it: the caster, whose procs its hooks run as. */
  readonly owner: G['bearer'];

  /** The entity id its hits are credited to. */
  readonly source: number;

  /** The side its catches are relative to: its owner's as it spawned (`host.sideOf`, else the world's). */
  readonly side: number;

  /** The cast it belongs to, kept alive while it lives; `undefined` when it spawned outside a cast. */
  readonly cast: SpellContext<G> | undefined;

  /** Its cast's rank, or 1. */
  readonly rank: number;

  /** Its cast's stats as plain numbers (empty outside a cast). */
  readonly stats: Readonly<Record<string, unknown>>;

  /** Its cast's stats as proc amounts (empty outside a cast). */
  readonly scaled: Readonly<Record<string, number | ScaledSnapshot>>;

  /** What its spawn handed it. */
  readonly input: G['areaInput'] | undefined;

  /** Where it is: its own to move (`move`, `frame`); an owner-anchored one is moved to its owner before each frame. */
  readonly position: Position;

  /** The heading it faces, as `atan2(x, z)`: its shape turns with it. Its own to change. */
  heading: number;

  /** Where it was at the start of this frame, or where its last `advance` piece began. */
  readonly previous: Vec2;

  /** Its shape, placed at its position and turned to its heading once its own motion this frame is done. */
  readonly shape: Shape;

  /** The tick it spawned on. */
  readonly spawnTick: number;

  /** The seconds it has lived, suspended time left out. */
  readonly age: number;

  /** The seconds left of its lifetime; infinite for one that lives while its owner does, or until spent. */
  readonly remaining: number;

  /** Whether its bound's `suspendWhile` holds it now (its clock and hooks wait). */
  readonly isSuspended: boolean;

  /** The area trigger whose procs spawned it, if any. */
  readonly parent: AreaTriggerHandle;

  /** Its own state (`AreaTriggerDef.state`). */
  readonly state: State;

  /** The game's own fields. */
  readonly ext: G['areaExt'];

  /** The clock's tick now. */
  readonly tick: number;

  /** The clock's step, in seconds. */
  readonly dt: number;

  /** The host. */
  readonly host: AreaTriggerHost<G> & G['host'];

  /** The world it asks. */
  readonly world: WorldQuery<G['bearer']>;

  /** The area triggers it may ask about (another tempest's goal, the domes a shot meets). */
  readonly areas: AreaQueries<G>;

  /** Applies one proc now, as its owner's and credited to it, and returns what it did. */
  readonly apply: (proc: Proc<G>) => ProcOutcome;

  /**
   * A draw source: a named stream of the host's table, or the system's own without a name. A keyed stream is keyed by
   * `key(targetId, index)`, so its draws depend on that key alone: pass each target's id (and an index for several
   * rolls on one target), or every call rolls the same (a nova critting all or none).
   */
  readonly random: (stream?: G['stream'], targetId?: number, index?: number) => Random;

  /** Its keyed-roll key: `(spawnTick, id, kind, targetId, index)` in a reused array, read at once. */
  readonly key: (targetId?: number, index?: number) => readonly number[];

  /** Ends it once the running hook returns: as `self` by default, `spent`, or one of the game's reasons. */
  readonly despawn: (reason?: 'self' | 'spent' | G['endReason']) => void;

  /**
   * Moves it along one straight piece of its path to `to`, its contact sweeping that piece now, in order: a curve drawn
   * as several pieces a frame (a chakram's arc), a bounce as two (a glaive off a wall), a teleport as none (move it
   * with `position` instead, and nothing between is swept). For a `move` or `frame` hook; the frame's own contact
   * sweeps only what is left after the last piece. Nothing is swept for a kind with no `contact`.
   */
  readonly advance: (to: Vec2) => void;

  /**
   * Sets the seconds left of its lifetime (a recast refreshing a pool, a kill extending it, a haste), counted from
   * after this frame: finite from 0 (0 expires it at this frame's end), or infinite. Throws for any other.
   */
  readonly setRemaining: (seconds: number) => void;

  /**
   * One of its kind's hit ledgers, by name, for a hook that records its own hits (a chain's links, a
   * frame's sweep): a reused view, read at once; throws for a name its kind does not declare.
   */
  readonly ledger: (name: string) => AreaLedger<G['bearer']>;
}

/**
 * What ends an area trigger early, or suspends it. Each part is optional; its owner leaving the world is told by the
 * game (`areaTriggers.ownerGone`). Its owner going down, or holding an interrupt, is the game's to read in
 * `suspendWhile` or `when`.
 */
export interface AreaBound<G extends AreaTriggerTypes, State = unknown> {
  /** Its owner must stay `present` (in the world): it ends as `source-gone` as the owner leaves (`ownerGone`). */
  readonly owner?: 'present';

  /**
   * Suspends it while true, its clock and hooks too, checked before each frame: its owner down (Ember Blades keep
   * their clock), or frozen (`spells.isInterrupted`: a frozen caster's telegraphs pause, even from casts that ended).
   */
  suspendWhile?(this: void, c: AreaTriggerContext<G, State>): boolean;

  /** A condition it lives under (the granting spell still owned): false ends it as `bound`. */
  when?(this: void, c: AreaTriggerContext<G, State>): boolean;
}

/** How many of a kind one owner may have at once, and what a spawn past it does. */
export interface AreaLimit<G extends AreaTriggerTypes, State = unknown> {
  /** The most at once per owner, from 1: a number, or read from the spawning cast's stats. */
  readonly perOwner: number | AreaFn<G, State, number>;

  /**
   * What a spawn past the limit does: end the oldest as `replaced` (`oldest`, the default), or refuse the new one
   * (`refuse`). An end the game wants silent is its end cue answering none for the reason (`cues.end`).
   */
  readonly replace?: 'oldest' | 'refuse';
}

/** The cues an area trigger fires at its moments, at its position, credited to its owner. */
export interface AreaCues<G extends AreaTriggerTypes, State = unknown> {
  /** It spawned. */
  spawn?(this: void, c: AreaTriggerContext<G, State>): CueSpec | undefined;

  /** It ended, for any reason; `undefined` for an end the game wants silent. */
  end?(this: void, c: AreaTriggerContext<G, State>, reason: EndReason<G>): CueSpec | undefined;
}

/** How long an area trigger lives: seconds, while its owner is present (`owner`), or until its hit budget is spent. */
export type Lifetime = number | 'owner' | 'spent';

/**
 * An area trigger kind: what a spell leaves in the world, with a position, a shape, a lifetime and hooks.
 * Plain data and standalone hooks, registered by name (`defineAreaTriggers`); `State` is each instance's own state.
 * `frame` is the primitive; the other hooks are the common cases built beside it.
 */
export interface AreaTriggerDef<G extends AreaTriggerTypes, State = unknown> {
  /** Its tags: what `coveredBy` and the queries over area triggers read. */
  readonly tags?: readonly G['areaTag'][];

  /** The tick slot it is stepped in; the first slot when absent. */
  readonly tickIn?: TickSlotId;

  /**
   * Its shape, relative to itself: the origin is its position and headings turn with its heading (a lane running ahead
   * is `lane({ length, width, dir: 0 })`); a function of it is read again at every frame.
   */
  readonly shape: Shape | AreaFn<G, State, Shape>;

  /** How long it lives: seconds, `owner`, `spent`, or a function of it read once at the spawn. */
  readonly lifetime: Lifetime | AreaFn<G, State, Lifetime>;

  /** Where it sits: where it spawned, moved only by its hooks (`world`, the default), or on its owner (`owner`). */
  readonly anchor?: 'world' | 'owner';

  /** What ends it early, or suspends it. */
  readonly bound?: AreaBound<G, State>;

  /** How many one owner may have at once. */
  readonly limit?: AreaLimit<G, State>;

  /**
   * An aura its owner holds while any of its kind lives: the area trigger's listeners are that aura's
   * triggers, so every trigger stays on an aura. Of infinite duration, shared by overlapping instances.
   */
  readonly ownerAura?: G['auraName'] | AuraId;

  /** The cues it fires. */
  readonly cues?: AreaCues<G, State>;

  /**
   * The order of its frame's parts, each at most once: `move` (then its shape is placed again), `contact`
   * (the sweep along this frame's move), `frame`, `pulses` and `auras`; `['move', 'contact', 'frame', 'pulses',
   * 'auras']` by default.
   */
  readonly order?: readonly AreaPhase[];

  /** Its hit ledgers by name, which its catches name and its hooks read with `c.ledger`. */
  readonly ledgers?: Readonly<Record<string, AreaLedgerSpec>>;

  /** Its swept contacts, which `onContact` receives. */
  readonly contact?: AreaContact<G, State>;

  /** Its pulses, in the order they beat within a frame. */
  readonly every?: readonly AreaPulse<G, State>[];

  /** What `onLand` catches as it expires (a telegraph firing); its foes when absent. */
  readonly land?: AreaCatch<G, State>;

  /** Whether each of its hits is also its cast's (`spells.hit`: the cast's `onHit`, its cue and its event). */
  readonly hitsCast?: boolean;

  /** The auras it keeps on the units in its shape. */
  readonly auras?: readonly AreaAura<G, State>[];

  /**
   * Its declared view: the numbers other code may read about an instance (`areas.viewOf`: a goal, a
   * charge), so no one reads its state directly. Its readers read it at once, so it may fill and return one record
   * it keeps, allocating nothing per read.
   */
  view?(this: void, c: AreaTriggerContext<G, State>): Readonly<Record<string, number>>;

  /**
   * What of it crosses the wire: entries of its view with their rounding, or `events-only` (the default);
   * `areaTriggers.replicate` writes it.
   */
  readonly replicate?: AreaReplication;

  /** Makes an instance's own state, once per spawn; `undefined` when absent. */
  state?(this: void): State;

  /** Runs once it has its entity id and before its first frame, with what its spawn handed it. */
  init?(this: void, c: AreaTriggerContext<G, State>, input: G['areaInput'] | undefined): void;

  /** Its own motion (steer, home, orbit): moves `c.position` and `c.heading` by `dt`. */
  move?(this: void, c: AreaTriggerContext<G, State>, dt: number): void;

  /** The primitive: one pass per frame over its `dt`, returning procs. */
  frame?(this: void, c: AreaTriggerContext<G, State>, dt: number, out: ProcOut<G>): ProcReturn<G>;

  /** Its sweep along this frame's move reached units, in the order it reached them. */
  onContact?(this: void, c: AreaTriggerContext<G, State>, hit: AreaHit<G>, out: ProcOut<G>): ProcReturn<G>;

  /** Its lifetime ran out, with the units in its shape (a telegraph firing, a hammer), before `onExpire`. */
  onLand?(this: void, c: AreaTriggerContext<G, State>, hit: AreaHit<G>, out: ProcOut<G>): ProcReturn<G>;

  /** Its lifetime ran out (the fling, the collapse, the dome's burst), before `onEnd`. */
  onExpire?(this: void, c: AreaTriggerContext<G, State>, out: ProcOut<G>): ProcReturn<G>;

  /** It ended, whatever the reason: where the game releases what it holds. */
  onEnd?(this: void, c: AreaTriggerContext<G, State>, reason: EndReason<G>, out: ProcOut<G>): ProcReturn<G>;
}

/** Any area trigger kind of a game, whatever its state: what a registry holds. */
export type AnyAreaTriggerDef<G extends AreaTriggerTypes> = AreaTriggerDef<G>;

/**
 * Fixes an area trigger kind's game types and returns the identity that infers its state from the definition: `const
 * areaTrigger = defineAreaTrigger<Game>();` then `export const pool = areaTrigger({ shape: circle(2), lifetime: 4 })`.
 */
export const defineAreaTrigger =
  <G extends AreaTriggerTypes>() =>
  <State = undefined>(def: AreaTriggerDef<G, State>): AreaTriggerDef<G, State> =>
    def;
