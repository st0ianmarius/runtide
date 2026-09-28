import { NO_SOURCE } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { Random } from '../core/index.ts';
import type { Shape, Vec2 } from '../math/index.ts';
import type { ScaledSnapshot } from '../modifiers/index.ts';
import type { Proc, ProcOrigin, ProcOutcome } from '../procs/index.ts';
import { type CastHandle, NO_CAST, type SpellContext } from '../spells/index.ts';
import type { WorldQuery } from '../world/index.ts';
import { AuraInside } from './area-auras.ts';
import type { AreaTriggerContext, EndReason, Position } from './area-def.ts';
import type { AreaTriggerHost } from './area-host.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import type { AreaLedger } from './delivery-def.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
import type { Ledger } from './ledgers.ts';
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

  /** Applies one proc for an area trigger. */
  readonly applyFor: (area: AreaTrigger<G>, proc: Proc<G>) => ProcOutcome;

  /** A draw source for an area trigger. */
  readonly randomFor: (area: AreaTrigger<G>, stream: G['stream'] | undefined) => Random;

  /** The reused view of one of an area trigger's ledgers. */
  readonly ledgerFor: (area: AreaTrigger<G>, name: string) => AreaLedger<G['bearer']>;
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
 * One area trigger, pooled (§I.5.4): the context its hooks receive and the store's own state for it, its links in the
 * tick order and in its kind's creation order included. A class for fast properties; its functions are arrow fields,
 * so a hook may call them detached.
 */
export class AreaTrigger<G extends AreaTriggerTypes> implements AreaTriggerContext<G> {
  handle: AreaTriggerHandle = NO_AREA_TRIGGER;
  id = 0;
  kind: AreaTriggerId = toId<'areaTriggers'>(0);
  owner: G['bearer'];
  source = NO_SOURCE;
  cast: SpellContext<G> | undefined = undefined;
  rank = 1;
  stats: Readonly<Record<string, unknown>> = NO_STATS;
  scaled: Readonly<Record<string, number | ScaledSnapshot>> = NO_SCALED;
  input: G['areaInput'] | undefined = undefined;
  readonly position: Position = { x: 0, z: 0 };
  heading = 0;
  readonly previous: Position = { x: 0, z: 0 };
  spawnTick = 0;
  age = 0;
  remaining = 0;
  isSuspended = false;
  parent: AreaTriggerHandle = NO_AREA_TRIGGER;
  state: unknown = undefined;
  readonly ext: G['areaExt'];
  locked: G['bearer'] | undefined = undefined;

  /** The seconds to each own-clock pulse's next beat, by pulse index. */
  readonly beats: number[] = [];

  /** The seconds of arming left; 0 once armed. */
  arming = 0;

  /** The seconds to its next own cast, for a kind that casts. */
  castBeat = 0;

  /** The hit ledgers it holds, by name. */
  readonly ledgers = new Map<string, Ledger>();

  /** The cast it holds alive; none outside a cast. */
  castHandle: CastHandle = NO_CAST;

  /** The owner's entity id. */
  ownerId = NO_SOURCE;

  /** Its tick slot. */
  slot = 0;

  /** The kind whose tick-order list it sits in: its own, or its parent's when it ticks after its parent. */
  listKind = 0;

  /** The next and previous in its tick-order list. */
  tickNext: AreaTrigger<G> | undefined = undefined;
  tickPrev: AreaTrigger<G> | undefined = undefined;

  /** The next and previous of its kind, in creation order. */
  kindNext: AreaTrigger<G> | undefined = undefined;
  kindPrev: AreaTrigger<G> | undefined = undefined;

  /** The last child that ticks right after it, which the next such child follows. */
  lastChild: AreaTrigger<G> | undefined = undefined;

  /** The tick it last stepped on, so one spawned or stepped at once this tick waits for the next. */
  steppedTick = -1;

  /** Why a hook asked it to end, applied once the hook returns; `undefined` when none did. */
  pending: EndReason | undefined = undefined;

  /** Whether it is ending or ended: nothing runs for it again. */
  isEnding = false;

  /** Whether its end fires no end cue. */
  isSilent = false;

  /** Whether it lives while its owner does (its lifetime is `owner`). */
  isOwnerLifetime = false;

  /** Who its procs run for. */
  readonly origin: AreaOrigin<G>;

  /** Its placed shape. */
  readonly placer = new ShapePlacer();

  /** The placers of its pulses' own shapes, by pulse index, made on first use. */
  readonly #pulsePlacers: ShapePlacer[] = [];

  /** The units inside each of its auras, by aura index, made on first use. */
  readonly #insides: AuraInside<G['bearer']>[] = [];

  readonly #services: AreaServices<G>;
  readonly #key = [0, 0, 0, 0, 0];

  constructor(services: AreaServices<G>, owner: G['bearer'], ext: G['areaExt']) {
    this.#services = services;
    this.owner = owner;
    this.ext = ext;
    this.origin = new AreaOrigin<G>(owner);
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

  readonly apply = (proc: Proc<G>): ProcOutcome => this.#services.applyFor(this, proc);

  readonly random = (stream?: G['stream']): Random => this.#services.randomFor(this, stream);

  readonly key = (targetId = 0, index = 0): readonly number[] => {
    const key = this.#key;

    key[0] = this.spawnTick;
    key[1] = this.id;
    key[2] = this.kind;
    key[3] = targetId;
    key[4] = index;

    return key;
  };

  readonly despawn = (reason: 'self' | 'spent' = 'self'): void => {
    this.pending ??= reason;
  };

  readonly lock = (unit: G['bearer'] | undefined): void => {
    this.locked = unit;
  };

  readonly ledger = (name: string): AreaLedger<G['bearer']> => this.#services.ledgerFor(this, name);

  /** The placer of a pulse's own shape. */
  placerFor(index: number): ShapePlacer {
    return (this.#pulsePlacers[index] ??= new ShapePlacer());
  }

  /** The units inside one of its auras. */
  insideOf(index: number): AuraInside<G['bearer']> {
    return (this.#insides[index] ??= new AuraInside<G['bearer']>());
  }

  /** Moves it to a point: where it spawns, or its owner's position for an owner-anchored one. */
  moveTo(at: Vec2): void {
    this.position.x = at.x;
    this.position.z = at.z;
  }
}
