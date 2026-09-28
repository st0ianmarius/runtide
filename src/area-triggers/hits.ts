import type { Shape, Vec2 } from '../math/index.ts';
import type { ProcOut, ProcReturn } from '../spells/index.ts';
import type { QueryOptions, QuerySide, SweepOptions } from '../world/index.ts';
import type { AreaTriggerContext } from './area-def.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaCatch, AreaHit } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';
import { recordIn } from './ledgers.ts';

/** A hit an engine reuses, one per nesting level. */
export class Hit<G extends AreaTriggerTypes> implements AreaHit<G> {
  /** The units caught, exactly as many as were caught. */
  readonly targets: G['bearer'][] = [];

  /** Each unit's share. */
  readonly shares: number[] = [];

  target: unknown = undefined;
  at: Vec2 | undefined = undefined;
  shape: Shape | undefined = undefined;
  pulse = -1;

  /** Fixes how many units it holds, every share 1. */
  size(count: number): void {
    this.targets.length = count;

    for (let i = 0; i < count; i++) {
      this.shares[i] = 1;
    }

    this.shares.length = count;
  }
}

/** The options a catch queries the world with, reused: the side relative to the owner, and the unit filter. */
class CatchOptions<G extends AreaTriggerTypes> implements QueryOptions<G['bearer']>, SweepOptions<G['bearer']> {
  side: QuerySide = 'foes';
  of: G['bearer'];
  readonly measure = 'edge';
  radius = 0;
  readonly relative = true;
  area: AreaTrigger<G> | undefined = undefined;
  spec: AreaCatch<G> | undefined = undefined;

  constructor(of: G['bearer']) {
    this.of = of;
  }

  /** The unit filter: the spec's condition, and the locked unit for a locked contact. */
  readonly filter = (unit: G['bearer']): boolean => {
    const { area, spec } = this;

    if (area === undefined || (this.isLocked && area.locked !== unit)) {
      return false;
    }

    return spec?.unitFilter?.(area, unit) ?? true;
  };

  /** Whether the catch only reaches the area trigger's locked unit. */
  isLocked = false;
}

/** What a catch is: whose, with which spec, in which shape (or along which segment), for which pulse. */
export interface CatchRequest<G extends AreaTriggerTypes> {
  /** The area trigger. */
  readonly area: AreaTrigger<G>;

  /** Whom it may reach. */
  readonly spec: AreaCatch<G> | undefined;

  /** The pulse it is for, or -1. */
  readonly pulse: number;
}

/** The hits and options of one engine, by nesting level. */
export class Catcher<G extends AreaTriggerTypes> {
  readonly #hits: Hit<G>[] = [];
  readonly #options: CatchOptions<G>[] = [];
  readonly #from = { x: 0, z: 0 };
  readonly #to = { x: 0, z: 0 };
  readonly #segment: readonly [Vec2, Vec2] = [this.#from, this.#to];

  #depth = 0;

  /** Takes the hit of the next level, emptied and aimed at the area trigger; give it back with `give`. */
  take(area: AreaTrigger<G>, pulse: number): Hit<G> {
    const hit = (this.#hits[this.#depth] ??= new Hit<G>());

    this.#depth += 1;
    hit.size(0);
    hit.target = area.cast?.target;
    hit.at = area.position;
    hit.shape = area.shape;
    hit.pulse = pulse;

    return hit;
  }

  /** Gives back the hit `take` handed out last. */
  give(hit: Hit<G>): void {
    hit.size(0);
    hit.target = undefined;
    this.#depth -= 1;
  }

  /** The reused options of the current level, set for a catch. */
  optionsFor(request: CatchRequest<G>, isLocked: boolean): CatchOptions<G> {
    const options = (this.#options[this.#depth] ??= new CatchOptions<G>(request.area.owner));

    options.side = request.spec?.side ?? 'foes';
    options.of = request.area.owner;
    options.area = request.area;
    options.spec = request.spec;
    options.isLocked = isLocked;

    return options;
  }

  /** The reused segment from where an area trigger was at the start of its frame to where it is. */
  segmentOf(area: AreaTrigger<G>): readonly [Vec2, Vec2] {
    this.#from.x = area.previous.x;
    this.#from.z = area.previous.z;
    this.#to.x = area.position.x;
    this.#to.z = area.position.z;

    return this.#segment;
  }

  /** Lets go of what the options of the current level point at. */
  release(): void {
    const options = this.#options[this.#depth];

    if (options !== undefined) {
      options.area = undefined;
      options.spec = undefined;
    }
  }
}

/** Writes the units in a shape into a hit, as a catch sees them; returns how many. */
export const catchIn = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [request, shape]: readonly [CatchRequest<G>, Shape],
  hit: Hit<G>,
): number => {
  const count = engine.world.inside(shape, engine.catcher.optionsFor(request, false), hit.targets);

  engine.catcher.release();
  hit.size(count);

  return count;
};

/** Writes the units a sweep along its frame's move reaches into a hit, in the order it reaches them. */
export const catchAlong = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [request, radius]: readonly [CatchRequest<G>, number],
  hit: Hit<G>,
): number => {
  const { area } = request;
  const options = engine.catcher.optionsFor(request, area.locked !== undefined);

  options.radius = radius;

  const count = engine.world.sweep(engine.catcher.segmentOf(area), options, hit.targets);

  engine.catcher.release();
  hit.size(count);

  return count;
};

/**
 * Records a hit in the ledger its catch names (§II.6 W3): the units its policy refuses leave the hit, the rest keep
 * their shares in order; a ledger that is spent after it (or was already) ends the area trigger as `spent` once the
 * running part is done. Nothing for a catch that names no ledger.
 */
export const recordHit = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [area, name]: readonly [AreaTrigger<G>, string | undefined],
  hit: Hit<G>,
): void => {
  const ledger = name === undefined ? undefined : area.ledgers.get(name);

  if (ledger === undefined) {
    return;
  }

  let kept = 0;

  for (const unit of hit.targets) {
    const share = recordIn(engine, [ledger, area.handle], engine.world.idOf(unit));

    if (share > 0) {
      hit.targets[kept] = unit;
      hit.shares[kept] = share;
      kept += 1;
    }
  }

  hit.targets.length = kept;
  hit.shares.length = kept;

  if (ledger.isSpent) {
    area.pending ??= 'spent';
  }
};

/** A hook that receives a hit. */
type HitHook<G extends AreaTriggerTypes> = (
  c: AreaTriggerContext<G>,
  hit: AreaHit<G>,
  out: ProcOut<G>,
) => ProcReturn<G>;

/**
 * Hands a hit to a hook and runs its procs, then to the area trigger's cast when its kind says so (`hitsCast`: the
 * cast's `onHit`, cue and event).
 */
export const deliver = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [area, hook]: readonly [AreaTrigger<G>, HitHook<G> | undefined],
  hit: Hit<G>,
): void => {
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
