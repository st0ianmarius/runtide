import type { Vec2 } from '../math/index.ts';
import { type CastHandle, NO_CAST } from '../spells/index.ts';
import type { AnyAreaTriggerDef, Lifetime } from './area-def.ts';
import { type AreaTrigger, NO_SCALED, NO_STATS } from './area-trigger.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import { AFTER_PARENT, ANCHOR_OWNER } from './define-area-triggers.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';
import { linkKind, linkTick } from './order.ts';
import { placeShape, stepArea } from './stepper.ts';

/** What a spawn is asked with (§II.3.4): who owns it, where, and what it starts with. */
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
   * The seconds of this frame it flies at once (§II.3.4: a fork flying on with its parent's leftover time); without it
   * its first frame is the next tick's.
   */
  readonly now?: number | undefined;

  /** Whether it shares its parent's state by reference (siblings sharing their passes); its own by default. */
  readonly shareState?: boolean | undefined;
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

/** Fills a new area trigger's cast, held alive while it lives (§II.6 S6), and what it reads from it. */
const bindCast = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, spec: SpawnSpec<G>) => {
  const cast = spec.cast ?? engine.spells.current;
  const context = engine.spells.hold(cast) ? engine.spells.get(cast) : undefined;

  area.castHandle = context === undefined ? NO_CAST : cast;
  area.cast = context;

  if (context === undefined) {
    area.rank = 1;
    area.stats = NO_STATS;
    area.scaled = NO_SCALED;

    return;
  }

  area.rank = context.rank;
  area.stats = context.stats;
  area.scaled = context.scaled;
};

/** Fills a new area trigger's credit: its owner's id, and the source its hits are credited to. */
const bindCredit = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, spec: SpawnSpec<G>) => {
  area.ownerId = engine.host.idOf?.(area.owner) ?? 0;
  area.source = spec.source ?? area.cast?.source ?? area.ownerId;
  area.origin.source = area.source;
};

/** Fills a new area trigger's place, time and state. */
const fill = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  [spec, parent]: readonly [SpawnSpec<G>, AreaTrigger<G> | undefined],
): void => {
  const { registry } = engine;

  area.moveTo(spec.at);
  area.previous.x = spec.at.x;
  area.previous.z = spec.at.z;
  area.heading = spec.heading ?? 0;
  area.input = spec.input;
  area.spawnTick = engine.clock.tick;
  area.steppedTick = engine.clock.tick;
  area.age = 0;
  area.isSuspended = false;
  area.isSilent = false;
  area.parent = parent?.handle ?? NO_AREA_TRIGGER;
  area.slot = registry.columns.slot[area.kind] ?? 0;
  area.listKind = area.kind;
  area.state = spec.shareState === true && parent !== undefined ? parent.state : registry.hooks.state[area.kind]?.();
};

/**
 * Whether the limit lets it in (§II.3.4): under it, yes; at it, the owner's oldest of the kind ends as `replaced`
 * (silently for `silent`), or the new one is refused (`refuse`).
 */
const admitLimit = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  def: AnyAreaTriggerDef<G>,
): boolean => {
  const { limit } = def;

  if (limit === undefined) {
    return true;
  }

  const perOwner = typeof limit.perOwner === 'function' ? limit.perOwner(area) : limit.perOwner;

  if (engine.countOf(area.owner, area.kind) < perOwner) {
    return true;
  }

  if (limit.replace === 'refuse') {
    return false;
  }

  for (let walk = engine.kindHeads[area.kind]; walk !== undefined; walk = walk.kindNext) {
    if (walk.owner === area.owner && !walk.isEnding) {
      endArea(engine, walk, { reason: 'replaced', isSilent: limit.replace === 'silent' });
      break;
    }
  }

  return true;
};

/** Makes it live: its id, lifetime, place in the orders, `init`, owner aura, cue and event. */
const enter = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  [def, parent]: readonly [AnyAreaTriggerDef<G>, AreaTrigger<G> | undefined],
): void => {
  const { registry } = engine;
  const flags = registry.columns.flags[area.kind] ?? 0;
  const lifetime = typeof def.lifetime === 'function' ? def.lifetime(area) : def.lifetime;

  area.id = engine.allocateId();
  area.remaining = secondsOf(registry.name(area.kind), lifetime);
  area.isOwnerLifetime = lifetime === 'owner';

  if ((flags & ANCHOR_OWNER) !== 0) {
    area.moveTo((engine.host.positionOf ?? engine.world.positionOf)(area.owner));
  }

  linkTick(engine, area, (flags & AFTER_PARENT) === 0 ? undefined : parent);
  linkKind(engine, area);
  engine.count(area.owner, [area.kind, 1]);
  placeShape(engine, area);
  registry.hooks.init[area.kind]?.(area, area.input);
  engine.holdOwnerAura(area, true);
  engine.fire(area, def.cues?.spawn?.(area));
  engine.raise('spawned', area);
};

/**
 * Spawns an area trigger of a kind (§II.3.4, §II.6 W4): its credit and cast captured, the limit applied, its entity id
 * allocated before `init`, linked into the tick order (after its parent when its kind says so), and flying at once for
 * `now` seconds when asked. Returns its handle, or `NO_AREA_TRIGGER` when the limit refused it.
 */
export const spawnArea = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  kind: AreaTriggerId,
  spec: SpawnSpec<G>,
): AreaTriggerHandle => {
  const def = engine.registry.get(kind);
  const parent = spec.parent === undefined ? engine.current : engine.areaOf(spec.parent);
  const area = engine.acquire(spec.owner);

  area.kind = kind;
  bindCast(engine, area, spec);
  bindCredit(engine, area, spec);
  fill(engine, area, [spec, parent]);

  if (!admitLimit(engine, area, def)) {
    engine.spells.release(area.castHandle);
    engine.free(area);

    return NO_AREA_TRIGGER;
  }

  enter(engine, area, [def, parent]);

  const { handle } = area;

  if (spec.now !== undefined && spec.now > 0 && !area.isEnding) {
    stepArea(engine, area, spec.now);
  }

  return handle;
};
