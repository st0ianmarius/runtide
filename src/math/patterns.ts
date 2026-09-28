import type { Vec2 } from './vec2.ts';

/** A pattern point: where it lands and how long after the pattern starts. */
export interface PatternPoint extends Vec2 {
  /** Seconds after the pattern starts. */
  readonly delay: number;
}

/** A line of points marching out from `from` along a heading. */
export interface LineSpec {
  /** Where the line starts. */
  readonly from: Vec2;

  /** The heading, as `atan2(x, z)`. */
  readonly dir: number;

  /** How far out the last point may be. */
  readonly length: number;

  /** The distance between points. */
  readonly spacing: number;

  /** How far out the first point is; 0 by default. */
  readonly first?: number;

  /** The delay added per point, so the line marches outward; 0 by default. */
  readonly stagger?: number;
}

/** Points evenly spaced on a circle. */
export interface RingSpec {
  /** The centre. */
  readonly at: Vec2;

  /** The radius. */
  readonly r: number;

  /** How many points. */
  readonly count: number;

  /** The heading of the first point; 0 by default. */
  readonly phase?: number;

  /** The delay added per point; 0 by default. */
  readonly stagger?: number;
}

/** Four lines from a centre, a quarter turn apart. */
export interface CrossSpec {
  /** The centre. */
  readonly at: Vec2;

  /** How far out each arm reaches. */
  readonly length: number;

  /** The distance between points on an arm. */
  readonly spacing: number;

  /** The heading of the first arm; 0 by default. */
  readonly dir?: number;

  /** How far out the first point of each arm is; `spacing` by default. */
  readonly first?: number;

  /** The delay added per step outward; 0 by default. */
  readonly stagger?: number;
}

/**
 * Points from `first` to `length` along a heading, `spacing` apart, each `stagger` later than the one before. The
 * distance is accumulated (`s += spacing`), as swarm's eruption lines do.
 */
export const linePoints = (spec: LineSpec): PatternPoint[] => {
  const ux = Math.sin(spec.dir);
  const uz = Math.cos(spec.dir);
  const stagger = spec.stagger ?? 0;
  const points: PatternPoint[] = [];

  for (let s = spec.first ?? 0, i = 0; s <= spec.length; s += spec.spacing, i++) {
    points.push({ x: spec.from.x + ux * s, z: spec.from.z + uz * s, delay: i * stagger });
  }

  return points;
};

/** `count` points on a circle, a full turn apart in equal steps from `phase`, each `stagger` later. */
export const ringPoints = (spec: RingSpec): PatternPoint[] =>
  Array.from({ length: spec.count }, (_unused, i) => {
    const heading = (spec.phase ?? 0) + (i * Math.PI * 2) / spec.count;

    return {
      x: spec.at.x + Math.sin(heading) * spec.r,
      z: spec.at.z + Math.cos(heading) * spec.r,
      delay: i * (spec.stagger ?? 0),
    };
  });

/**
 * Four arms a quarter turn apart, ordered by step outward and then by arm, so the delays never go back: each step
 * outward is `stagger` later.
 */
export const crossPoints = (spec: CrossSpec): PatternPoint[] => {
  const arms = [0, 1, 2, 3].map((arm) =>
    linePoints({
      from: spec.at,
      dir: (spec.dir ?? 0) + (arm * Math.PI) / 2,
      length: spec.length,
      spacing: spec.spacing,
      first: spec.first ?? spec.spacing,
      stagger: spec.stagger ?? 0,
    }),
  );

  return (arms[0] ?? []).flatMap((_point, step) => arms.flatMap((arm) => arm[step] ?? []));
};

/** `count` headings fanned evenly around `dir`, `spread` apart; one line returns just `dir`. */
export const fan = (dir: number, count: number, spread: number): number[] =>
  Array.from({ length: Math.max(1, count) }, (_unused, i) => dir + (i - (count - 1) / 2) * spread);
