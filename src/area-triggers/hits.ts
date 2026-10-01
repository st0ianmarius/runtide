import type { Shape, Vec2 } from '../math/index.ts';
import type { ProcOut, ProcReturn } from '../spells/index.ts';
import type { QueryOptions, QuerySide, SweepOptions } from '../world/index.ts';
import type { AreaTriggerContext } from './area-def.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaCatch, AreaHit } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';
import { type Ledger, recordIn } from './ledgers.ts';

/** No units: what a hit that caught nothing hands its hook, so its buffer is never shrunk to nothing. */
const NO_UNITS: readonly never[] = Object.freeze([]);

/** A hook that receives a hit. */
export type HitHook<G extends AreaTriggerTypes> = (
  c: AreaTriggerContext<G>,
  hit: AreaHit<G>,
  out: ProcOut<G>
) => ProcReturn<G>;

/**
 * A hit an engine reuses, one per nesting level: what one catch is for (its area trigger, spec and hook) and
 * what it caught. Its `targets` and `shares` are exactly as long as the catch; the buffers behind them are never shrunk
 * to nothing, since that drops their storage and the next catch would allocate it again.
 */
export class Hit<G extends AreaTriggerTypes> implements AreaHit<G> {
  /** The units caught, exactly as many as were caught. */
  targets: readonly G['bearer'][] = NO_UNITS;

  /** Each unit's share, in the order of `targets`. */
  shares: readonly number[] = NO_UNITS;

  /** The buffer the units are written into. */
  readonly units: G['bearer'][] = [];

  /** The buffer the shares are written into. */
  readonly weights: number[] = [];

  target: unknown = undefined;
  at: Vec2 | undefined = undefined;
  shape: Shape | undefined = undefined;
  pulse = -1;

  /** The area trigger it catches for. */
  area: AreaTrigger<G> | undefined = undefined;

  /** Whom it may reach, and the ledger it records in. */
  spec: AreaCatch<G> | undefined = undefined;

  /** The hook it is handed to. */
  hook: HitHook<G> | undefined = undefined;

  /** Keeps the first `count` units and shares of the buffers as its targets and shares. */
  keep(count: number): void {
    if (count === 0) {
      this.targets = NO_UNITS;
      this.shares = NO_UNITS;

      return;
    }

    if (this.units.length !== count) {
      this.units.length = count;
      this.weights.length = count;
    }

    this.targets = this.units;
    this.shares = this.weights;
  }

  /** Keeps the first `count` units of the buffer, each at a full share. */
  fill(count: number): void {
    for (let i = 0; i < count; i++) {
      this.weights[i] = 1;
    }

    this.keep(count);
  }
}

/** The options a catch queries the world with, reused: the side relative to the owner, and the unit filter. */
class CatchOptions<G extends AreaTriggerTypes> implements QueryOptions<G['bearer']>, SweepOptions<G['bearer']> {
  side: QuerySide = 'foes';
  of: G['bearer'];
  ofSide = 0;
  readonly measure = 'edge';
  radius = 0;
  readonly relative = true;
  since = 0;
  until = 1;
  isOpen = false;
  hit: Hit<G> | undefined = undefined;

  constructor(of: G['bearer']) {
    this.of = of;
  }

  /** The unit filter: the spec's condition. */
  readonly filter = (unit: G['bearer']): boolean => {
    const area = this.hit?.area;

    return area !== undefined && (this.hit?.spec?.unitFilter?.(area, unit) ?? true);
  };
}

/** The hits and options of one engine, by nesting level. */
export class Catcher<G extends AreaTriggerTypes> {
  readonly #hits: Hit<G>[] = [];
  readonly #options: CatchOptions<G>[] = [];

  /** The reused ends of the segment `aim` sets: where an area trigger was at the start of its frame, and is now. */
  readonly from = { x: 0, z: 0 };
  readonly to = { x: 0, z: 0 };

  #depth = 0;

  /**
   * Takes the hit of the next level, emptied and aimed at an area trigger for a spec and a hook; give it back with
   * `give`.
   */
  take(area: AreaTrigger<G>, spec: AreaCatch<G> | undefined, hook: HitHook<G> | undefined): Hit<G> {
    const hit = (this.#hits[this.#depth] ??= new Hit<G>());

    this.#depth += 1;
    hit.keep(0);
    hit.area = area;
    hit.spec = spec;
    hit.hook = hook;
    hit.target = area.cast?.target;
    hit.at = area.position;
    hit.shape = area.shape;
    hit.pulse = -1;

    return hit;
  }

  /** Gives back the hit `take` handed out last. */
  give(hit: Hit<G>): void {
    hit.keep(0);
    hit.area = undefined;
    hit.spec = undefined;
    hit.hook = undefined;
    hit.target = undefined;
    this.#depth -= 1;
  }

  /** The reused options of the current level, set for a hit's catch. */
  optionsFor(hit: Hit<G>, owner: G['bearer']): CatchOptions<G> {
    const options = (this.#options[this.#depth] ??= new CatchOptions<G>(owner));

    options.side = hit.spec?.side ?? 'foes';
    options.of = owner;
    options.ofSide = hit.area?.side ?? 0;
    options.hit = hit;

    return options;
  }

  /** Sets `from` and `to` to where an area trigger was at the start of its frame and where it is. */
  aim(area: AreaTrigger<G>): void {
    this.from.x = area.previous.x;
    this.from.z = area.previous.z;
    this.to.x = area.position.x;
    this.to.z = area.position.z;
  }

  /** Lets go of the hit the options of the current level point at. */
  release(): void {
    const options = this.#options[this.#depth];

    if (options !== undefined) {
      options.hit = undefined;
    }
  }
}

/** Catches the units in a shape into a hit, as its spec sees them; returns how many. */
export const catchIn = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, hit: Hit<G>, shape: Shape): number => {
  const { area } = hit;

  if (area === undefined) {
    return 0;
  }

  const count = engine.world.inside(shape, engine.catcher.optionsFor(hit, area.owner), hit.units);

  engine.catcher.release();
  hit.fill(count);

  return count;
};

/** Catches the units a sweep along its frame's move reaches into a hit, in the order it reaches them. */
export const catchAlong = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, hit: Hit<G>, radius: number): number => {
  const { area } = hit;

  if (area === undefined) {
    return 0;
  }

  const options = engine.catcher.optionsFor(hit, area.owner);

  // After an `advance` piece, it sweeps on from that piece's share of the frame and end, open so a joint counts once;
  // the frame's shares are the tick's from where the frame starts in it (a fork flying with the tick's leftover time).
  const { tickFrom } = area;

  options.radius = radius;
  options.since = tickFrom + area.advancedAt * (1 - tickFrom);
  options.until = tickFrom + area.sweepUntil * (1 - tickFrom);
  options.isOpen = area.hasAdvanced;

  engine.catcher.aim(area);

  const count = engine.world.sweep(engine.catcher.from, engine.catcher.to, options, hit.units);

  engine.catcher.release();
  hit.fill(count);

  return count;
};

/** The ledger a hit's spec names, as its area trigger holds it; none for a catch that names none. */
const ledgerOf = <G extends AreaTriggerTypes>(hit: Hit<G>): Ledger | undefined => {
  const { area, spec } = hit;
  const name = spec?.ledgerOf !== undefined && area !== undefined ? spec.ledgerOf(area) : spec?.ledger;

  if (name === undefined) {
    return undefined;
  }

  const ledger = area?.ledgers.get(name);

  if (ledger === undefined) {
    throw new RangeError(`An area trigger's catch picked ledger ${name}, which its kind does not declare.`);
  }

  return ledger;
};

/**
 * Records a hit in the ledger its spec names: the units its policy refuses leave the hit, the rest keep
 * their shares in order; a ledger that is spent after it (or was already) ends the area trigger as `spent` once the
 * running part is done. Nothing for a catch that names no ledger.
 */
export const recordHit = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, hit: Hit<G>): void => {
  const { area } = hit;
  const ledger = ledgerOf(hit);

  if (area === undefined || ledger === undefined) {
    return;
  }

  const count = hit.targets.length;
  let kept = 0;

  for (let i = 0; i < count; i++) {
    const unit = hit.units[i];
    const share = unit === undefined ? 0 : recordIn(engine, ledger, engine.world.idOf(unit));

    if (unit !== undefined && share > 0) {
      hit.units[kept] = unit;
      hit.weights[kept] = share * (hit.weights[i] ?? 1);
      kept += 1;
    }
  }

  hit.keep(kept);

  if (ledger.isSpent) {
    area.pending ??= 'spent';
  }
};

/**
 * Hands a hit to its hook and runs its procs, then to the area trigger's cast when its kind says so (`hitsCast`: the
 * cast's `onHit`, cue and event).
 */
export const deliver = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, hit: Hit<G>): void => {
  const { area, hook } = hit;

  if (area === undefined) {
    return;
  }

  if (hook !== undefined) {
    const list = engine.takeList();

    try {
      engine.run(area, hook(area, hit, list), list);
    } finally {
      engine.giveList(list);
    }
  }

  if (engine.registry.get(area.kind).hitsCast === true) {
    engine.spells.hit(area.castHandle, hit);
  }
};
