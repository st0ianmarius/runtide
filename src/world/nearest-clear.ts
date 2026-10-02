import type { Vec2 } from '../math/index.ts';
import type { WorldQuery } from './query.ts';

/** How far `nearestClear` looks, and how finely. */
export interface NearestClearOptions {
  /** The farthest a clear point may lie from the point asked about, a finite number from 0. */
  readonly maxDistance: number;

  /**
   * The spacing of the search: between its rings, and about that between the points of a ring. The larger of the
   * body's radius and a sixteenth of `maxDistance` by default, so at most 16 rings.
   */
  readonly step?: number;
}

/** The candidate a search tests, reused. */
const CANDIDATE = { x: 0, z: 0 };

/**
 * The clear point nearest `at` for a body of `radius` (`isPositionClear`, exactly, for each candidate): `at` itself
 * when clear, else the first clear point on rings `step` apart around it, nearest ring first, each ring's points
 * `step` apart or nearer, from heading 0 (+z) turning toward +x. No random draw: the same world and arguments give the
 * same point. Nearest to the step's resolution; `undefined` when no candidate within `maxDistance` is clear (a
 * spawn's or a knockback's landing the game then places otherwise). A depenetration for a body caught in a wall, a
 * spawn's ground near a wanted spot. Tests at most 1 + Σ⌈2πk⌉ for k = 1…K candidates, K = ⌊maxDistance / step⌋:
 * under π·K·(K + 1) + K + 1, about 870 at the default step's 16 rings. Throws for a point that is not finite, or a
 * radius, distance or step out of range.
 */
export const nearestClear = (
  world: Pick<WorldQuery<unknown>, 'isPositionClear'>,
  at: Vec2,
  radius: number,
  options: NearestClearOptions
): Vec2 | undefined => {
  const { maxDistance, step } = options;

  checkSearch(at, radius, options);

  if (world.isPositionClear(at, radius)) {
    return { x: at.x, z: at.z };
  }

  const spacing = step ?? Math.max(radius, maxDistance / 16);

  // A rounding short of a whole ring count (0.3 / 0.1) still reaches the last ring.
  const rings = maxDistance === 0 ? 0 : Math.floor((maxDistance / spacing) * (1 + 1e-12));

  for (let ring = 1; ring <= rings; ring++) {
    const found = onRing(world, at, radius, ring * spacing, Math.ceil(2 * Math.PI * ring));

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
};

/**
 * Throws for a search that is not for a finite point and a radius from 0, or whose distance or step is out of range:
 * checked here as well as by the world, which may not check, and a NaN would search nothing.
 */
const checkSearch = (at: Vec2, radius: number, { maxDistance, step }: NearestClearOptions): void => {
  if (!(Number.isFinite(at.x) && Number.isFinite(at.z) && Number.isFinite(radius) && radius >= 0)) {
    throw new RangeError(`A search is for a finite point and a radius from 0; got (${at.x}, ${at.z}) and ${radius}.`);
  }

  if (!(Number.isFinite(maxDistance) && maxDistance >= 0)) {
    throw new RangeError(`A search's distance is a finite number from 0; got ${maxDistance}.`);
  }

  if (step !== undefined && !(Number.isFinite(step) && step > 0)) {
    throw new RangeError(`A search's step is a finite number above 0; got ${step}.`);
  }
};

/** The first clear point of `count` evenly around a ring of `distance` about `at`, from heading 0, as a new vector. */
const onRing = (
  world: Pick<WorldQuery<unknown>, 'isPositionClear'>,
  at: Vec2,
  radius: number,
  distance: number,
  count: number
): Vec2 | undefined => {
  for (let i = 0; i < count; i++) {
    const heading = (i / count) * 2 * Math.PI;

    CANDIDATE.x = at.x + Math.sin(heading) * distance;
    CANDIDATE.z = at.z + Math.cos(heading) * distance;

    if (world.isPositionClear(CANDIDATE, radius)) {
      return { x: CANDIDATE.x, z: CANDIDATE.z };
    }
  }

  return undefined;
};
