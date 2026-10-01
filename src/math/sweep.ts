import type { Circle } from './shapes.ts';
import type { Vec2 } from './vec2.ts';

/**
 * The earliest share `t` in `[0, 1]` along the segment `from → to` at which it touches a circle, or `undefined` when it
 * never does. Initial overlap (the start at or inside the rim, which `covers` leaves out) is contact at 0; a segment no
 * longer than `1e-6` outside the circle never touches it. To sweep a moving body against a target, pass a circle whose
 * radius is the sum of both radii.
 */
export const sweepCircle = (from: Vec2, to: Vec2, target: Pick<Circle, 'at' | 'r'>): number | undefined => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const ox = from.x - target.at.x;
  const oz = from.z - target.at.z;
  const c = ox * ox + oz * oz - target.r * target.r;

  if (c <= 0) {
    return 0;
  }

  const a = dx * dx + dz * dz;

  if (a <= 1e-12) {
    return undefined;
  }

  const b = ox * dx + oz * dz;
  const discriminant = b * b - a * c;

  if (discriminant < 0) {
    return undefined;
  }

  const t = (-b - Math.sqrt(discriminant)) / a;

  return t >= 0 && t <= 1 ? t : undefined;
};
