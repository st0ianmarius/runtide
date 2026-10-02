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

/** A vector a caller owns and lets a read fill (`positionOf(unit, out)`). */
export interface MutableVec2 {
  /** The across coordinate. */
  x: number;

  /** The forward coordinate. */
  z: number;
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

/**
 * The length of `(dx, dz)`: `√(dx² + dz²)`, one correctly rounded square root, so the same float on every engine
 * (`Math.hypot` is only approximated by the spec, and boxes a number where it is not inlined).
 */
export const hypot = (dx: number, dz: number): number =>
  // oxlint-disable-next-line unicorn/prefer-modern-math-apis -- the point: one correctly rounded root, no Math.hypot
  Math.sqrt(dx * dx + dz * dz);

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

/**
 * The unit vector along `v`, or the origin for a zero vector. The components are first divided by the larger of them,
 * so a vector whose squared length would overflow (`(1e200, 1e200)`) or underflow (`(1e-200, 0)`) still has its
 * direction. One with a component that is not finite has none: NaN comes out, not a zero vector that reads as
 * standing still.
 */
export const normalize = (v: Vec2): Vec2 => {
  const larger = Math.max(Math.abs(v.x), Math.abs(v.z));

  if (larger === 0) {
    return ORIGIN;
  }

  if (!Number.isFinite(larger)) {
    return { x: Number.NaN, z: Number.NaN };
  }

  const x = v.x / larger;
  const z = v.z / larger;
  // oxlint-disable-next-line unicorn/prefer-modern-math-apis -- one correctly rounded root, as `hypot` above
  const length = Math.sqrt(x * x + z * z);

  return { x: x / length, z: z / length };
};

/** The point a share `t` of the way from `a` to `b`. */
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t
});
