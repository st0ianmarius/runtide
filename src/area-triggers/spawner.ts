import { NO_SOURCE } from '../auras/index.ts';
import type { Vec2 } from '../math/index.ts';
import { type CastHandle, NO_CAST } from '../spells/index.ts';
import { dropAreaAuras } from './area-auras.ts';
import { isLimit } from './area-checks.ts';
import type { AnyAreaTriggerDef, Lifetime } from './area-def.ts';
import { type AreaTrigger, NO_SCALED, NO_STATS } from './area-trigger.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import { ANCHOR_OWNER } from './define-area-triggers.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { placeShape } from './frame.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
import { closeLedgers, openLedgers } from './ledgers.ts';
import { linkKind } from './order.ts';
import { joinPulses } from './pulses.ts';
import { stepArea } from './stepper.ts';

/** What a spawn is asked with: who owns it, where, and what it starts with. */
export interface SpawnSpec<G extends AreaTriggerTypes> {
  /** Who spawns it: its procs run as theirs. */
  readonly owner: G['bearer'];

  /** Where it spawns (an owner-anchored one sits on its owner instead). */
  readonly at: Vec2;

  /** The heading it faces; 0 by default. */
  readonly heading?: number | undefined;

  /** What its `init` is handed. */
  readonly input?: G['areaInput'] | undefined;

  /** The entity id its hits are credited to; its owner's by default. */
  readonly source?: number | undefined;

  /** The cast it belongs to, held alive while it lives; the cast whose procs are running by default. */
  readonly cast?: CastHandle | undefined;

  /** The area trigger that spawned it; the one whose procs are running by default. */
  readonly parent?: AreaTriggerHandle | undefined;

  /**
   * The seconds of this frame it flies at once (a fork flying on with its parent's leftover time): the tick's last
   * seconds, so its sweep meets the units' motion over that part of the tick alone. Without it its first frame is the
   * next tick's.
   */
  readonly now?: number | undefined;
}

/** The lifetime's seconds, read once: infinite for `owner` and `spent`. */
const secondsOf = (name: string, lifetime: Lifetime): number => {
  if (lifetime === 'owner' || lifetime === 'spent') {
    return Number.POSITIVE_INFINITY;
  }

  if (!(Number.isFinite(lifetime) && lifetime > 0)) {
    throw new RangeError(`Area trigger ${name}: its lifetime is a finite number of seconds above 0; got ${lifetime}.`);
  }

  return lifetime;
};

/** Fills a new area trigger's cast, held alive while it lives, and what it reads from it. */
const bindCast = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, spec: SpawnSpec<G>) => {
  const cast = spec.cast ?? engine.spells.current;
  const context = engine.spells.retain(cast) ? engine.spells.get(cast) : undefined;

  area.castHandle = context === undefined ? NO_CAST : cast;
  area.cast = context;

  if (context === undefined) {
    area.rank = 1;
    area.stats = NO_STATS;
    area.scaled = NO_SCALED;

    return;
  }

  // A live cast takes its stats again before each hook; the area keeps its own copy of the ones it was made with.
  area.statsBox = engine.spells.copyStats(cast);
  area.rank = context.rank;
  area.stats = area.statsBox?.stats ?? context.stats;
  area.scaled = area.statsBox?.scaled ?? context.scaled;
};

/**
 * Fills a new area trigger's credit: its owner's id (`NO_SOURCE` without the host's `idOf`, as a proc's), and the
 * source its hits are credited to.
 */
const bindCredit = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, spec: SpawnSpec<G>) => {
  area.ownerId = engine.host.idOf?.(area.owner) ?? NO_SOURCE;
  area.source = spec.source ?? area.cast?.source ?? area.ownerId;
  area.origin.source = area.source;
};

/** Fills a new area trigger's place, time and state. */
const fill = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  spec: SpawnSpec<G>,
  parent: AreaTrigger<G> | undefined
): void => {
  const { registry } = engine;

  area.side = (engine.host.sideOf ?? engine.world.sideOf)(spec.owner);
  area.moveTo(spec.at);
  area.previous.x = spec.at.x;
  area.previous.z = spec.at.z;
  area.heading = spec.heading ?? 0;
  area.input = spec.input;
  area.spawnTick = engine.clock.tick;
  area.steppedTick = engine.clock.tick;
  area.age = 0;
  area.isSuspended = false;
  area.parent = parent?.handle ?? NO_AREA_TRIGGER;
  area.slot = registry.columns.slot[area.kind] ?? 0;
  area.state = registry.hooks.state[area.kind]?.();
};

/**
 * How many of the owner's area triggers of a kind are not ending, with the room held by spawns replacing one: one
 * whose end runs its hooks still counts in `countOf` until it is gone, but leaves room for one its `onEnd` spawns,
 * unless a spawn replacing it holds that room.
 */
const liveOf = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): number => {
  let live = 0;

  for (let walk = engine.ownerOf(area.owner)?.heads[area.kind]; walk !== undefined; walk = walk.ownerNext) {
    live += walk.isEnding ? 0 : 1;
  }

  for (const held of engine.admitting) {
    live += held !== area && held.owner === area.owner && held.kind === area.kind ? 1 : 0;
  }

  return live;
};

/** The owner's oldest area trigger of a kind that is not ending, if any. */
const oldestOf = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>
): AreaTrigger<G> | undefined => {
  for (let walk = engine.ownerOf(area.owner)?.heads[area.kind]; walk !== undefined; walk = walk.ownerNext) {
    if (!walk.isEnding) {
      return walk;
    }
  }

  return undefined;
};

/**
 * Whether the limit lets it in: under it, yes; at it, the owner's oldest of the kind ends as `replaced`, or
 * the new one is refused (`refuse`). While the oldest ends, the new one holds its room: a spawn its hooks make of the
 * same owner and kind, with nothing left to replace, is refused, and the new one is let in only if there is room after.
 * A `perOwner` function reading anything but a whole number from 1 throws.
 */
const admitLimit = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  def: AnyAreaTriggerDef<G>
): boolean => {
  const { limit } = def;

  if (limit === undefined) {
    return true;
  }

  const perOwner = typeof limit.perOwner === 'function' ? limit.perOwner(area) : limit.perOwner;

  if (!isLimit(perOwner)) {
    throw new RangeError(
      `Area trigger ${engine.registry.name(area.kind)}: its limit per owner is a whole number from 1; got ${perOwner}.`
    );
  }

  if (engine.countOf(area.owner, area.kind) < perOwner || liveOf(engine, area) < perOwner) {
    return true;
  }

  if (limit.replace === 'refuse') {
    return false;
  }

  const oldest = oldestOf(engine, area);

  if (oldest === undefined) {
    return false;
  }

  engine.admitting.push(area);
  oldest.successor = area;

  try {
    endArea(engine, oldest, 'replaced');
  } finally {
    oldest.successor = undefined;
    engine.admitting.pop();
  }

  return liveOf(engine, area) < perOwner;
};

/**
 * Gives it its id and lifetime, puts an owner-anchored one on its owner and opens its ledgers: nothing links it
 * anywhere yet.
 */
const settle = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  def: AnyAreaTriggerDef<G>
): void => {
  const { registry } = engine;

  area.id = engine.allocateId();

  const lifetime = typeof def.lifetime === 'function' ? def.lifetime(area) : def.lifetime;
  area.remaining = secondsOf(registry.name(area.kind), lifetime);
  area.isOwnerLifetime = lifetime === 'owner';

  if (((registry.columns.flags[area.kind] ?? 0) & ANCHOR_OWNER) !== 0) {
    area.moveTo((engine.host.positionOf ?? engine.world.positionOf)(area.owner, engine.point));
  }

  openLedgers(engine, area);
};

/**
 * Lets go of what a refused spawn took from the one it replaced: the units inside its area auras leave, and the owner
 * aura comes off when none of its kind is left.
 */
const dropHanded = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  try {
    dropAreaAuras(engine, area);
  } finally {
    if (area.keepsOwnerAura) {
      engine.holdOwnerAura(area, false);
    }
  }
};

/**
 * Fills it, asks its limit and settles it; whether it may enter. One the limit refuses, or whose filling throws (a
 * limit or lifetime of 0, a ledger's pierce read as 0), is let go with its cast, the ledgers it opened and what the one it
 * replaced handed it, before anything links it.
 */
const admit = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  spec: SpawnSpec<G>,
  parent: AreaTrigger<G> | undefined,
  def: AnyAreaTriggerDef<G>
): boolean => {
  let isAdmitted = false;

  try {
    bindCredit(engine, area, spec);
    fill(engine, area, spec, parent);

    if (admitLimit(engine, area, def)) {
      settle(engine, area, def);
      isAdmitted = true;
    }
  } finally {
    if (!isAdmitted) {
      try {
        dropHanded(engine, area);
      } finally {
        closeLedgers(engine, area);
        engine.spells.unretain(area.castHandle);
        engine.free(area);
      }
    }
  }

  return isAdmitted;
};

/**
 * Makes it live: its place in the orders, owner aura, `init`, pulses, cue and event. One whose owner aura or `init`
 * throws is ended, so nothing is left linked, counted or holding its cast.
 */
const enter = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  def: AnyAreaTriggerDef<G>
): void => {
  linkKind(engine, area);
  engine.count(area.owner, area.kind, 1);

  try {
    engine.holdOwnerAura(area, true);

    if (area.isEnding) {
      return;
    }

    placeShape(engine, area);

    const init = engine.registry.hooks.init[area.kind];

    if (init !== undefined) {
      init(area, area.input);

      // Its `init` ended it (a withdrawal that caught itself): it ended before it was ever announced.
      if (area.isEnding) {
        return;
      }

      // `init` may have moved or turned it.
      placeShape(engine, area);
    }

    joinPulses(engine, area);
  } catch (error) {
    endArea(engine, area, 'self');

    throw error;
  }

  engine.fire(area, def.cues?.spawn?.(area));
  engine.raise('spawned', area);
};

/**
 * Spawns an area trigger of a kind: its credit and cast captured, the limit applied, its entity id allocated before
 * `init`, linked last into its kind's tick order, and flying at once for `now` seconds when asked. Returns its handle,
 * or `NO_AREA_TRIGGER` when the limit refused it. The spec is read before `enter`, whose hooks and events may spawn
 * again with the same reused spec, or end this one and let a nested spawn take its record: it is found again by handle.
 */
export const spawnArea = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  kind: AreaTriggerId,
  spec: SpawnSpec<G>
): AreaTriggerHandle => {
  const def = engine.registry.get(kind);
  const parent = spec.parent === undefined ? engine.current : engine.areaOf(spec.parent);
  const area = engine.acquire(spec.owner);

  area.kind = kind;
  bindCast(engine, area, spec);

  // Read before the limit, whose replaced trigger's `onEnd` may spawn again with the same reused spec.
  const { now } = spec;

  if (!admit(engine, area, spec, parent, def)) {
    return NO_AREA_TRIGGER;
  }

  const { handle } = area;

  engine.hold();

  try {
    enter(engine, area, def);

    const live = engine.areaOf(handle);

    if (live?.pending !== undefined) {
      endArea(engine, live, live.pending);
    } else if (now !== undefined && now > 0 && live !== undefined) {
      stepArea(engine, live, now);
    }
  } finally {
    engine.unhold();
  }

  return handle;
};
