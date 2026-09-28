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
  AreaCaster,
  AreaCatch,
  AreaContact,
  AreaHit,
  AreaLedger,
  AreaLedgerSpec,
  AreaPhase,
  AreaPulse,
} from './delivery-def.ts';
import type { AreaTriggerHandle } from './ids.ts';

/**
 * Why an area trigger ended (§II.6 W1): `expired` (its lifetime ran out), `spent` (its hit budget ran out), `self` (a
 * hook despawned it), `bound` (a bound condition failed), `replaced` (a newer one took its place under the limit), or
 * `source-gone` (its owner left the world).
 */
export type EndReason = 'expired' | 'spent' | 'self' | 'bound' | 'replaced' | 'source-gone';

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
 * What every area trigger hook receives (§II.3.4): the area trigger itself, pooled, so a hook reads it while it runs
 * and never keeps it (it keeps the handle instead). Its credit and stats are its cast's, captured at the spawn; its own
 * motion (`position`, `heading`) and its `state` are its hooks' to change. Its functions may be called detached.
 */
export interface AreaTriggerContext<G extends AreaTriggerTypes, State = unknown> {
  /** Its handle, which stays valid until it ends. */
  readonly handle: AreaTriggerHandle;

  /** Its entity id, allocated by the host when it spawned (§II.6 W4). */
  readonly id: number;

  /** Its kind. */
  readonly kind: AreaTriggerId;

  /** Who spawned it: the caster, whose procs its hooks run as. */
  readonly owner: G['bearer'];

  /** The entity id its hits are credited to. */
  readonly source: number;

  /** The cast it belongs to, kept alive while it lives (§II.6 S6); `undefined` when it spawned outside a cast. */
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

  /** Where it was at the start of this frame. */
  readonly previous: Vec2;

  /** Its shape, placed at its position and turned to its heading once its own motion this frame is done. */
  readonly shape: Shape;

  /** The tick it spawned on. */
  readonly spawnTick: number;

  /** The seconds it has lived, suspended time left out. */
  readonly age: number;

  /** The seconds left of its lifetime; infinite for one that lives while its owner does, or until spent. */
  readonly remaining: number;

  /** Whether it is suspended while its owner is down (its clock and hooks wait). */
  readonly isSuspended: boolean;

  /** The area trigger whose procs spawned it, if any. */
  readonly parent: AreaTriggerHandle;

  /** Its own state (`AreaTriggerDef.state`), or its parent's when it shares it. */
  readonly state: State;

  /** The game's own fields (§I.5.6 hatch 4). */
  readonly ext: G['areaExt'];

  /** The clock's tick now. */
  readonly tick: number;

  /** The clock's step, in seconds. */
  readonly dt: number;

  /** The host. */
  readonly host: AreaTriggerHost<G> & G['host'];

  /** The world it asks. */
  readonly world: WorldQuery<G['bearer']>;

  /** Applies one proc now, as its owner's and credited to it, and returns what it did (§II.6.1 rule 2). */
  readonly apply: (proc: Proc<G>) => ProcOutcome;

  /** A draw source: a named stream of the host's table (a keyed one keyed by `key()`), or the system's own. */
  readonly random: (stream?: G['stream']) => Random;

  /** Its keyed-roll key: `(spawnTick, id, kind, targetId, index)` in a reused array, read at once. */
  readonly key: (targetId?: number, index?: number) => readonly number[];

  /** Ends it once the running hook returns (§II.6 W1): as `self` by default, or `spent`. */
  readonly despawn: (reason?: 'self' | 'spent') => void;

  /** The one unit its contacts may reach, when it is locked on one (§II.6 W3: a homing missile); none when absent. */
  readonly locked: G['bearer'] | undefined;

  /** Locks its contacts onto one unit, or frees them with `undefined`. */
  readonly lock: (unit: G['bearer'] | undefined) => void;

  /**
   * One of its kind's hit ledgers, by name (§II.6 W3), for a hook that records its own hits (a chain's links, a
   * frame's sweep): a reused view, read at once; throws for a name its kind does not declare.
   */
  readonly ledger: (name: string) => AreaLedger<G['bearer']>;
}

/**
 * What ends an area trigger early, or suspends it (§II.6 W1). Each part is optional; the owner's presence and standing
 * are the host's answers (`isPresent`, `isStanding`).
 */
export interface AreaBound<G extends AreaTriggerTypes, State = unknown> {
  /**
   * Its owner must stay `present` (in the world: ends as `source-gone` when it leaves) or `standing` (as well not down:
   * ends as `bound`, or waits, as `whileDown` says).
   */
  readonly owner?: 'present' | 'standing';

  /** What it does while its standing-bound owner is down: `end` (the default) or `suspend` (its clock waits). */
  readonly whileDown?: 'end' | 'suspend';

  /** A condition it lives under (the granting spell still owned): false ends it as `bound`. */
  when?(this: void, c: AreaTriggerContext<G, State>): boolean;

  /** Whether a bound end fires its end cue (`fade`, the default) or not (`silent`). */
  readonly cue?: 'fade' | 'silent';
}

/** How many of a kind one owner may have at once, and what a spawn past it does (§II.3.4, §II.6 W5). */
export interface AreaLimit<G extends AreaTriggerTypes, State = unknown> {
  /** The most at once per owner, from 1: a number, or read from the spawning cast's stats. */
  readonly perOwner: number | AreaFn<G, State, number>;

  /**
   * What a spawn past the limit does: end the oldest as `replaced` (`oldest`, the default, its end cue fired), end it
   * silently (`silent`), or refuse the new one (`refuse`).
   */
  readonly replace?: 'oldest' | 'silent' | 'refuse';
}

/** The cues an area trigger fires at its moments, at its position, credited to its owner. */
export interface AreaCues<G extends AreaTriggerTypes, State = unknown> {
  /** It spawned. */
  spawn?(this: void, c: AreaTriggerContext<G, State>): CueSpec | undefined;

  /** It ended (not for a silent end). */
  end?(this: void, c: AreaTriggerContext<G, State>, reason: EndReason): CueSpec | undefined;
}

/** How long an area trigger lives: seconds, while its owner lives (`owner`), or until its hit budget is spent. */
export type Lifetime = number | 'owner' | 'spent';

/**
 * An area trigger kind (§II.3.4): what a spell leaves in the world, with a position, a shape, a lifetime and hooks.
 * Plain data and standalone hooks, registered by name (`defineAreaTriggers`); `State` is each instance's own state.
 * `frame` is the primitive; the other hooks are the common cases built beside it.
 */
export interface AreaTriggerDef<G extends AreaTriggerTypes, State = unknown> {
  /** Its tags: what `coveredBy` and the queries over area triggers read. */
  readonly tags?: readonly G['areaTag'][];

  /** The tick slot it is stepped in (§II.6.1 rule 1); the first slot when absent. */
  readonly tickIn?: TickSlotId;

  /** Where a child it spawns first ticks: in its own kind's place (the default), or right after its parent. */
  readonly insert?: 'after-parent';

  /**
   * Its shape, relative to itself: the origin is its position and headings turn with its heading (a lane running ahead
   * is `lane({ length, width, dir: 0 })`); a function of it is read again at every frame.
   */
  readonly shape: Shape | AreaFn<G, State, Shape>;

  /** How long it lives: seconds, `owner`, `spent`, or a function of it read once at the spawn. */
  readonly lifetime: Lifetime | AreaFn<G, State, Lifetime>;

  /**
   * When its lifetime is checked against its frame (§II.6 W2): `after` it (the default: the last frame runs whole),
   * `before` it (no frame on the expiry tick), or `clip` (the last frame runs with `dt` cut to the time left).
   */
  readonly expiry?: 'after' | 'before' | 'clip';

  /** Where it sits: where it spawned, moved only by its hooks (`world`, the default), or on its owner (`owner`). */
  readonly anchor?: 'world' | 'owner';

  /** What ends it early, or suspends it (§II.6 W1). */
  readonly bound?: AreaBound<G, State>;

  /** How many one owner may have at once. */
  readonly limit?: AreaLimit<G, State>;

  /**
   * An aura its owner holds while any of its kind lives (§II.3.7): the area trigger's listeners are that aura's
   * triggers, so every trigger stays on an aura. Of infinite duration, shared by overlapping instances.
   */
  readonly ownerAura?: G['auraName'] | AuraId;

  /** The cues it fires. */
  readonly cues?: AreaCues<G, State>;

  /**
   * The order of its frame's parts (§II.6 W2), each at most once: `move` (then its shape is placed again), `contact`
   * (the sweep along this frame's move), `frame` and `pulses`. `['move', 'contact', 'frame', 'pulses']` by default.
   */
  readonly order?: readonly AreaPhase[];

  /**
   * The seconds before its frame's parts start (§II.6 W2: the sentry arming): its lifetime counts meanwhile, and the
   * tick it arms on runs them with the time left over.
   */
  readonly arming?: number;

  /** Its hit ledgers by name (§II.6 W3), which its catches name and its hooks read with `c.ledger`. */
  readonly ledgers?: Readonly<Record<string, AreaLedgerSpec>>;

  /** Its swept contacts, which `onContact` receives. */
  readonly contact?: AreaContact<G, State>;

  /** Its pulses, in the order they beat within a frame. */
  readonly every?: readonly AreaPulse<G, State>[];

  /** What `onLand` catches as it expires (a telegraph firing); its foes when absent. */
  readonly land?: AreaCatch<G, State>;

  /** Whether each of its hits is also its cast's (`spells.hit`: the cast's `onHit`, its cue and its event). */
  readonly hitsCast?: boolean;

  /** The spell it casts on its own clock. */
  readonly caster?: AreaCaster<G, State>;

  /** Makes an instance's own state, once per spawn; `undefined` when absent (or its parent's, when shared). */
  state?(this: void): State;

  /** Runs once it has its entity id and before its first frame (§II.6 W4), with what its spawn handed it. */
  init?(this: void, c: AreaTriggerContext<G, State>, input: G['areaInput'] | undefined): void;

  /** Its own motion (steer, home, orbit): moves `c.position` and `c.heading` by `dt`. */
  move?(this: void, c: AreaTriggerContext<G, State>, dt: number): void;

  /** The primitive: one pass per frame over its `dt`, returning procs (§II.3.4). */
  frame?(this: void, c: AreaTriggerContext<G, State>, dt: number, out: ProcOut<G>): ProcReturn<G>;

  /** Its sweep along this frame's move reached units, in the order it reached them. */
  onContact?(this: void, c: AreaTriggerContext<G, State>, hit: AreaHit<G>, out: ProcOut<G>): ProcReturn<G>;

  /** Its lifetime ran out, with the units in its shape (a telegraph firing, a hammer), before `onExpire`. */
  onLand?(this: void, c: AreaTriggerContext<G, State>, hit: AreaHit<G>, out: ProcOut<G>): ProcReturn<G>;

  /** Its lifetime ran out (the fling, the collapse, the dome's burst), before `onEnd`. */
  onExpire?(this: void, c: AreaTriggerContext<G, State>, out: ProcOut<G>): ProcReturn<G>;

  /** It ended, whatever the reason (§II.6 W1): where shared claims are released. */
  onEnd?(this: void, c: AreaTriggerContext<G, State>, reason: EndReason, out: ProcOut<G>): ProcReturn<G>;
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
