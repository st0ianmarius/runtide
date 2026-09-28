import type { Vec2 } from './vec2.ts';

const TAU = Math.PI * 2;

/**
 * An angle wrapped into `(−π, π]` by remainder, with no trigonometry, so it is exact on every platform. Angles are
 * headings in radians measured as `atan2(x, z)`: 0 faces +z, π/2 faces +x.
 */
export const wrap = (angle: number): number => {
  const turned = angle % TAU;

  if (turned > Math.PI) {
    return turned - TAU;
  }

  return turned <= -Math.PI ? turned + TAU : turned;
};

/** The signed shortest turn from `from` to `to`, in `(−π, π]`. */
export const angleDelta = (from: number, to: number): number => wrap(to - from);

/**
 * Turns `from` toward `to` by the share `rate` of the shortest turn, and wraps the result into `(−π, π]`:
 * `wrap(from + angleDelta(from, to) × rate)`. A rate of 1 lands on `to` (wrapped) and 0 stays at `from`.
 */
export const turnToward = (from: number, to: number, rate: number): number => wrap(from + angleDelta(from, to) * rate);

/** The heading of a direction: `atan2(x, z)`. */
export const headingOf = (v: Vec2): number => Math.atan2(v.x, v.z);

/** The unit direction of a heading: `(sin, cos)`. */
export const directionOf = (heading: number): Vec2 => ({ x: Math.sin(heading), z: Math.cos(heading) });
