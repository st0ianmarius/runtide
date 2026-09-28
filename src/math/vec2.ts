/**
 * A point or direction on the ground plane: `x` across, `z` forward. Structurally compatible with a game's own
 * `{ x, z }` vector, so the game passes its positions in as they are.
 */
export interface Vec2 {
  /** The across coordinate. */
  readonly x: number;

  /** The forward coordinate. */
  readonly z: number;
}

/** The origin, frozen. */
export const ORIGIN: Vec2 = Object.freeze({ x: 0, z: 0 });

/** A new vector. */
export const vec2 = (x: number, z: number): Vec2 => ({ x, z });

/** The sum `a + b`, as a new vector. */
export const addVec = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });

/** The difference `a − b`, as a new vector. */
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });

/** The vector scaled by `k`, as a new vector. */
export const scale = (v: Vec2, k: number): Vec2 => ({ x: v.x * k, z: v.z * k });

/** The dot product. */
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;

/** The 2D cross product `a.x × b.z − a.z × b.x`: positive when `b` turns counter-clockwise from `a` in x-z. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.z - a.z * b.x;

/** The squared length, with no square root. */
export const lengthSq = (v: Vec2): number => v.x * v.x + v.z * v.z;

/** The length. */
export const lengthOf = (v: Vec2): number => Math.sqrt(lengthSq(v));

/** The squared distance between two points, with no square root. */
export const distanceSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;

  return dx * dx + dz * dz;
};

/** The distance between two points. */
export const distance = (a: Vec2, b: Vec2): number => Math.sqrt(distanceSq(a, b));

/** The unit vector along `v`, or the origin for a zero vector. */
export const normalize = (v: Vec2): Vec2 => {
  const length = lengthOf(v);

  return length > 0 ? { x: v.x / length, z: v.z / length } : ORIGIN;
};

/** The point a share `t` of the way from `a` to `b`. */
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
