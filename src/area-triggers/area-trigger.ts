import { NO_SOURCE } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { Random } from '../core/index.ts';
import type { Shape, Vec2 } from '../math/index.ts';
import type { ScaledSnapshot } from '../modifiers/index.ts';
import type { Proc, ProcOrigin, ProcOutcome } from '../procs/index.ts';
import { type CastHandle, NO_CAST, type SpellContext, type StatsBox } from '../spells/index.ts';
import type { WorldQuery } from '../world/index.ts';
import { AuraInside } from './area-auras.ts';
import type { AreaTriggerContext, EndReason, Position } from './area-def.ts';
import type { AreaTriggerHost } from './area-host.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';
import type { AreaLedger } from './delivery-def.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
import type { Ledger } from './ledgers.ts';
import type { AreaQueries } from './queries.ts';
import { ShapePlacer } from './shape-placer.ts';

/** No stats: an area trigger spawned outside a cast. */
export const NO_STATS: Readonly<Record<string, number>> = Object.freeze({});

/** No proc amounts. */
export const NO_SCALED: Readonly<Record<string, number | ScaledSnapshot>> = Object.freeze({});

/** What an area trigger's own functions call back into: the engine that runs it. */
export interface AreaServices<G extends AreaTriggerTypes> {
  /** The host. */
  readonly host: AreaTriggerHost<G> & G['host'];

  /** The world. */
  readonly world: WorldQuery<G['bearer']>;

  /** The clock's tick now. */
  readonly tick: number;

  /** The clock's step. */
  readonly dt: number;

  /** The registry, whose end reasons a hook's `despawn` may name. */
  readonly registry: AreaTriggerRegistry<G>;

  /** Applies one proc for an area trigger. */
  readonly applyFor: (area: AreaTrigger<G>, proc: Proc<G>) => ProcOutcome;

  /** A draw source for an area trigger. */
  readonly randomFor: (stream: G['stream'] | undefined, key: readonly number[]) => Random;

  /** The reused view of one of an area trigger's ledgers. */
  readonly ledgerFor: (area: AreaTrigger<G>, name: string) => AreaLedger<G['bearer']>;

  /** The queries over the area triggers. */
  readonly queries: AreaQueries<G>;

  /** Moves an area trigger along one piece of its path, its contact sweeping it (`advance`). */
  readonly advanceFor: (area: AreaTrigger<G>, to: Vec2, at?: number) => void;
}

/** Who an area trigger's procs run for: its owner, credited to its source. */
export class AreaOrigin<G extends AreaTriggerTypes> implements ProcOrigin<G> {
  self: G['bearer'];
  target: G['bearer'];
  source = NO_SOURCE;

  constructor(self: G['bearer']) {
    this.self = self;
    this.target = self;
  }
}

/**
 * One area trigger, pooled: the context its hooks receive and the store's own state for it, its links in the
 * tick order and in its kind's creation order included. A class for fast properties; its functions are arrow fields,
 * so a hook may call them detached.
 */
export class AreaTrigger<G extends AreaTriggerTypes> implements AreaTriggerContext<G> {
  handle: AreaTriggerHandle = NO_AREA_TRIGGER;
  id = 0;
  kind: AreaTriggerId = toId<'areaTriggers'>(0);
  owner: G['bearer'];
  source = NO_SOURCE;

  /** The side its catches are relative to: its owner's as it spawned. */
  side = 0;

  cast: SpellContext<G> | undefined = undefined;
  rank = 1;
  statsBox: StatsBox | undefined = undefined;
  stats: Readonly<Record<string, unknown>> = NO_STATS;
  scaled: Readonly<Record<string, number | ScaledSnapshot>> = NO_SCALED;
  input: G['areaInput'] | undefined = undefined;
  readonly position: Position = { x: 0, z: 0 };
  heading = 0;
  readonly previous: Position = { x: 0, z: 0 };
  spawnTick = 0;
  age = 0;
  remaining = 0;

  /** Whether a hook set its time left during this frame, which then does not count down. */
  isLifeSet = false;
  isSuspended = false;
  parent: AreaTriggerHandle = NO_AREA_TRIGGER;
  state: unknown = undefined;
  readonly ext: G['areaExt'];

  /**
   * The seconds to each pulse's next beat, by pulse index: a typed array as long as any kind's pulses, so a frame's
   * count-down writes a number in place rather than a boxed one into a plain array.
   */
  readonly beats: Float64Array;

  /** The time this frame's parts run over. */
  frameTime = 0;

  /**
   * The share of the tick this frame starts at: 0 for a whole tick's frame, later for one spawned flying with the
   * tick's leftover time (`now`), whose sweeps then meet the units' motion over that last part of the tick alone.
   */
  tickFrom = 0;

  /** Whether an `advance` this frame swept up to where it stands, so the frame's contact has nothing left to sweep. */
  hasAdvanced = false;

  /** The share of this frame its last `advance` piece reached, where its next sweep of the units' motion starts. */
  advancedAt = 0;

  /** The share of this frame its current sweep reaches: the `advance` piece's, else the frame's end. */
  sweepUntil = 1;

  /** The hit ledgers it holds, by name. */
  readonly ledgers = new Map<string, Ledger>();

  /** The cast it holds alive; none outside a cast. */
  castHandle: CastHandle = NO_CAST;

  /** The owner's entity id. */
  ownerId = NO_SOURCE;

  /** Its tick slot. */
  slot = 0;

  /** The next and previous of its kind, in creation order (its tick order). */
  kindNext: AreaTrigger<G> | undefined = undefined;
  kindPrev: AreaTrigger<G> | undefined = undefined;

  /** The next and previous of its owner's of its kind, in creation order (`stepOwner` walks these). */
  ownerNext: AreaTrigger<G> | undefined = undefined;
  ownerPrev: AreaTrigger<G> | undefined = undefined;

  /** The tick it last stepped on, so one spawned or stepped at once this tick waits for the next. */
  steppedTick = -1;

  /** Why a hook asked it to end, applied once the hook returns; `undefined` when none did. */
  pending: EndReason<G> | undefined = undefined;

  /** Whether it is ending or ended: nothing runs for it again. */
  isEnding = false;

  /** Whether it lives while its owner does (its lifetime is `owner`). */
  isOwnerLifetime = false;

  /** Who its procs run for. */
  readonly origin: AreaOrigin<G>;

  /** Its placed shape. */
  readonly placer = new ShapePlacer();

  /** The placers of its pulses' own shapes, by pulse index, made on first use. */
  readonly #pulsePlacers: ShapePlacer[] = [];

  /** The units inside each of its auras, by aura index, made on first use. */
  readonly #insides: AuraInside<G>[] = [];

  readonly #services: AreaServices<G>;
  readonly #key = [0, 0, 0, 0, 0];

  constructor(services: AreaServices<G>, owner: G['bearer'], ext: G['areaExt']) {
    this.#services = services;
    this.owner = owner;
    this.ext = ext;
    this.origin = new AreaOrigin<G>(owner);
    this.beats = new Float64Array(Math.max(0, ...services.registry.defs.map((def) => def?.every?.length ?? 0)));
  }

  get shape(): Shape {
    return this.placer.shape;
  }

  get tick(): number {
    return this.#services.tick;
  }

  get dt(): number {
    return this.#services.dt;
  }

  get host(): AreaTriggerHost<G> & G['host'] {
    return this.#services.host;
  }

  get world(): WorldQuery<G['bearer']> {
    return this.#services.world;
  }

  get areas(): AreaQueries<G> {
    return this.#services.queries;
  }

  readonly apply = (proc: Proc<G>): ProcOutcome => this.#services.applyFor(this, proc);

  readonly advance = (to: Vec2, at?: number): void => {
    this.#services.advanceFor(this, to, at);
  };

  readonly random = (stream?: G['stream'], targetId = 0, index = 0): Random =>
    this.#services.randomFor(stream, this.key(targetId, index));

  readonly key = (targetId = 0, index = 0): readonly number[] => {
    const key = this.#key;

    key[0] = this.spawnTick >>> 0;
    key[1] = this.id;
    key[2] = this.kind;
    key[3] = targetId;
    key[4] = index;

    return key;
  };

  readonly despawn = (reason: 'self' | 'spent' | G['endReason'] = 'self'): void => {
    if (this.#services.registry.reasonCodes[reason] === undefined) {
      throw new RangeError(`Area triggers: unknown end reason ${reason}.`);
    }

    this.pending ??= reason;
  };

  readonly setRemaining = (seconds: number): void => {
    if (!(seconds >= 0)) {
      throw new RangeError(`An area trigger's lifetime is seconds from 0; got ${seconds}.`);
    }

    this.remaining = seconds;
    this.isLifeSet = true;
  };

  readonly ledger = (name: string): AreaLedger<G['bearer']> => this.#services.ledgerFor(this, name);

  /** The placer of a pulse's own shape. */
  placerFor(index: number): ShapePlacer {
    return (this.#pulsePlacers[index] ??= new ShapePlacer());
  }

  /** The units inside one of its auras. */
  insideOf(index: number): AuraInside<G> {
    return (this.#insides[index] ??= new AuraInside<G>(this, index));
  }

  /** Moves it to a point: where it spawns, or its owner's position for an owner-anchored one. */
  moveTo(at: Vec2): void {
    this.position.x = at.x;
    this.position.z = at.z;
  }
}
