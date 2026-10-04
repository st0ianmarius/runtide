import { digest } from '../core/digest.ts';
import type { Shape } from '../math/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';
import type { Ledger } from './ledgers.ts';

/** What a missing optional number (a ledger with no pierce, an area trigger with no pending end) folds as. */
const NONE = -1;

/** A flag as a number. */
const bit = (flag: boolean): number => (flag ? 1 : 0);

/** Folds a point's coordinates. */
const foldPoint = (hash: number, at: { readonly x: number; readonly z: number }): number =>
  digest(digest(hash, at.x), at.z);

/** Folds a cone's or a lane's numbers past its start. */
const foldHeaded = (hash: number, shape: Extract<Shape, { kind: 'cone' | 'lane' }>): number => {
  if (shape.kind === 'cone') {
    return digest(digest(digest(digest(hash, shape.r), shape.half), shape.dir), shape.apex);
  }

  return digest(digest(digest(digest(hash, shape.length), shape.width), shape.dir), shape.back);
};

/** Folds a polygon's corners and band. */
const foldPolygon = (hash: number, shape: Extract<Shape, { kind: 'polygon' }>): number => {
  let next = digest(digest(hash, shape.band), shape.points.length);

  for (const at of shape.points) {
    next = foldPoint(next, at);
  }

  return next;
};

/** Folds the parts of a shape made of shapes. */
const foldComposite = (hash: number, shape: Extract<Shape, { kind: 'outside' | 'union' | 'difference' }>): number => {
  if (shape.kind === 'outside') {
    return foldShape(hash, shape.shape);
  }

  if (shape.kind === 'difference') {
    return foldShape(foldShape(hash, shape.base), shape.minus);
  }

  let next = digest(hash, shape.shapes.length);

  for (const part of shape.shapes) {
    next = foldShape(next, part);
  }

  return next;
};

/** The code each shape kind folds as. */
const SHAPE_CODES: Readonly<Record<Shape['kind'], number>> = {
  point: 0,
  circle: 1,
  ring: 2,
  cone: 3,
  lane: 4,
  polygon: 5,
  outside: 6,
  union: 7,
  difference: 8
};

/** Folds a placed shape: its kind, then its numbers as placed (positions, radii, headings), recursively. */
const foldShape = (hash: number, shape: Shape): number => {
  const next = digest(hash, SHAPE_CODES[shape.kind]);

  switch (shape.kind) {
    case 'point':
      return foldPoint(next, shape.at);
    case 'circle':
      return digest(foldPoint(next, shape.at), shape.r);
    case 'ring':
      return digest(digest(foldPoint(next, shape.at), shape.inner), shape.outer);
    case 'cone':
    case 'lane':
      return foldHeaded(foldPoint(next, shape.at), shape);
    case 'polygon':
      return foldPolygon(next, shape);
    case 'outside':
    case 'union':
    case 'difference':
      return foldComposite(next, shape);
  }
};

/**
 * Folds the live area triggers into a hash in id order, allocating nothing: every walk is a field of it, and its
 * map walks are `forEach` calls with callbacks made once.
 */
export class AreaDigest<G extends AreaTriggerTypes> {
  readonly #engine: AreaEngine<G>;

  /** Each kind's place in its list as the walk merges the kinds' lists by id. */
  readonly #cursors: (AreaTrigger<G> | undefined)[];

  /** The hash a map walk folds into. */
  #hash = 0;

  constructor(engine: AreaEngine<G>) {
    this.#engine = engine;
    this.#cursors = Array.from({ length: engine.registry.size }, () => undefined);
  }

  /**
   * Folds every live area trigger into `hash`, by ascending id: each kind's list is in creation order, so ids rise
   * along it, and the walk merges the lists by taking the lowest id at their heads. Then the count folded.
   */
  fold(hash: number): number {
    const cursors = this.#cursors;
    let next = hash;
    let count = 0;

    for (let kind = 0; kind < cursors.length; kind++) {
      cursors[kind] = this.#engine.kindHeads[kind];
    }

    for (let area = this.#lowest(); area !== undefined; area = this.#lowest()) {
      cursors[area.kind] = area.kindNext;

      if (!area.isEnding) {
        next = this.#foldArea(next, area);
        count += 1;
      }
    }

    return digest(next, count);
  }

  /** The area trigger with the lowest id at the cursors, or `undefined` once every list is walked. */
  #lowest(): AreaTrigger<G> | undefined {
    let lowest: AreaTrigger<G> | undefined = undefined;

    for (const area of this.#cursors) {
      if (area !== undefined && (lowest === undefined || area.id < lowest.id)) {
        lowest = area;
      }
    }

    return lowest;
  }

  /** Folds one area trigger: who and where it is, its clocks, its shape, pulses, aura insides and ledgers. */
  #foldArea(hash: number, area: AreaTrigger<G>): number {
    let next = this.#foldIdentity(hash, area);

    next = this.#foldClocks(next, area);
    next = foldShape(next, area.shape);
    next = this.#foldPulses(next, area);
    next = this.#foldInsides(next, area);
    next = this.#foldStats(next, area);
    next = digest(next, area.ledgers.size);
    this.#hash = next;
    area.ledgers.forEach(this.#foldLedger);

    return this.#hash;
  }

  /** Folds who it is and where: id, kind, handle (pool slot and generation), owner, side, cast, parent and pose. */
  #foldIdentity(hash: number, area: AreaTrigger<G>): number {
    let next = digest(digest(digest(hash, area.id), area.kind), area.handle);

    next = digest(digest(digest(next, area.ownerId), area.side), area.source);
    next = digest(digest(digest(next, area.castHandle), area.parent), area.rank);
    next = digest(foldPoint(next, area.position), area.heading);

    return foldPoint(next, area.previous);
  }

  /** Folds its clocks and flags: lifetime left, age, its frame's timing, suspension and a pending end. */
  #foldClocks(hash: number, area: AreaTrigger<G>): number {
    const { pending } = area;
    const reason = pending === undefined ? NONE : (this.#engine.registry.reasonCodes[pending] ?? NONE);
    let next = digest(digest(digest(hash, area.slot), area.spawnTick), area.steppedTick);

    next = digest(digest(digest(next, area.remaining), area.age), bit(area.isLifeSet));
    next = digest(digest(digest(next, area.frameTime), area.tickFrom), area.advancedAt);
    next = digest(digest(next, bit(area.hasAdvanced)), bit(area.isSuspended));

    return digest(digest(next, bit(area.isOwnerLifetime)), reason);
  }

  /** Folds each of its kind's pulse clocks: the seconds to the next beat. */
  #foldPulses(hash: number, area: AreaTrigger<G>): number {
    const pulses = this.#engine.registry.get(area.kind).every?.length ?? 0;
    let next = digest(hash, pulses);

    for (let index = 0; index < pulses; index++) {
      next = digest(next, area.beats[index] ?? 0);
    }

    return next;
  }

  /** Folds each of its kind's auras' insides: the wait to its next catch and the ids inside, ascending. */
  #foldInsides(hash: number, area: AreaTrigger<G>): number {
    const auras = this.#engine.registry.get(area.kind).auras?.length ?? 0;
    let next = digest(hash, auras);

    for (let index = 0; index < auras; index++) {
      const inside = area.insideIfAny(index);
      const count = inside?.count ?? 0;

      next = digest(digest(next, inside?.wait ?? 0), count);

      for (let i = 0; i < count; i++) {
        next = digest(next, inside?.ids[i] ?? NONE);
      }
    }

    return next;
  }

  /** Folds the numbers of the stats it snapshotted at its cast, in their key order, and each scaled amount's rank. */
  #foldStats(hash: number, area: AreaTrigger<G>): number {
    const { stats, scaled } = area;
    let next = hash;

    for (const key in stats) {
      const value = stats[key];

      next = typeof value === 'number' ? digest(next, value) : next;
    }

    for (const key in scaled) {
      const value = scaled[key];

      next = typeof value === 'number' ? digest(next, value) : digest(next, value?.rank ?? NONE);
    }

    return next;
  }

  /**
   * Folds one of its ledgers (in its kind's declared order): its counts, limits and watermark, then each unit's entity id
   * and the tick it was last hit, in the ledger's insertion order, which is the order of first hits since its last
   * prune: the same for a given history, so it is folded as it stands rather than sorted.
   */
  readonly #foldLedger = (ledger: Ledger): void => {
    let next = digest(digest(digest(this.#hash, ledger.distinct), ledger.hits), ledger.watermark);

    next = digest(digest(next, ledger.pierce ?? NONE), ledger.budget ?? NONE);
    this.#hash = digest(next, ledger.last.size);
    ledger.last.forEach(this.#foldHit);
  };

  /** Folds one unit of a ledger: its entity id and the tick it was last hit on. */
  readonly #foldHit = (last: number, unit: number): void => {
    this.#hash = digest(digest(this.#hash, unit), last);
  };
}
