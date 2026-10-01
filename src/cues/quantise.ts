/** The param kind codes a compiled schema stores, one per `CueParamKind`, in this order. */
export const PARAM_KINDS = ['f32', 'fixed', 'int', 'uint8', 'angle', 'vec2', 'vec2[]', 'entity', 'id'] as const;

/** A float32. */
export const F32 = 0;

/** A fixed-point number. */
export const FIXED = 1;

/** A whole number. */
export const INT = 2;

/** A byte. */
const UINT8 = 3;

/** An angle. */
const ANGLE = 4;

/** A point. */
export const VEC2 = 5;

/** A list of points. */
export const VEC2_LIST = 6;

/** An entity id. */
export const ENTITY = 7;

/** A registry id. */
const REGISTRY_ID = 8;

/** The largest magnitude a whole wire number takes, so its zigzag form stays a safe integer. */
const LIMIT = 2 ** 51;

/** A full turn. */
const TURN = 2 * Math.PI;

/** A rounded number kept finite and within the wire's range; NaN becomes 0. */
const whole = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(LIMIT, Math.max(-LIMIT, Math.round(value))) + 0;
};

/** An angle's step: its share of a turn, wrapped into [0, 1), in whole steps; NaN and infinities become 0. */
const angleStep = (value: number, steps: number): number => {
  const turns = value / TURN;
  const step = Math.round((turns - Math.floor(turns)) * steps);

  return step >= 0 && step < steps ? step + 0 : 0;
};

/**
 * The wire form of one number of a param (one coordinate of a point): a float32 for `f32`, a whole number for every
 * other kind. `scale` is the kind's steps per unit (per turn for an angle). Never throws: NaN and infinities are
 * clamped, so a bad value costs a wrong number, never a broken batch.
 */
export const quantise = (kind: number, scale: number, value: number): number => {
  switch (kind) {
    case F32: {
      // JSON writes infinities and NaN as null, which no reader takes back.
      return Number.isFinite(value) ? Math.fround(value) : 0;
    }

    case FIXED:
    case VEC2:
    case VEC2_LIST: {
      return whole(value * scale);
    }

    case UINT8: {
      return Math.min(255, Math.max(0, whole(value)));
    }

    case ANGLE: {
      return angleStep(value, scale);
    }

    case ENTITY: {
      // Anything but an entity id is nobody, as an owner is: NaN must not become entity 0.
      return Number.isSafeInteger(value) && value >= 0 ? value : -1;
    }

    case REGISTRY_ID: {
      return Math.max(0, whole(value));
    }

    default: {
      return whole(value);
    }
  }
};

/** The number a wire form stands for: what a receiver reads, and what the sender's value becomes on the wire. */
export const dequantise = (kind: number, scale: number, wire: number): number => {
  switch (kind) {
    case FIXED:
    case VEC2:
    case VEC2_LIST: {
      return wire / scale + 0;
    }

    case ANGLE: {
      return ((wire >= scale / 2 ? wire - scale : wire) * TURN) / scale + 0;
    }

    default: {
      return wire;
    }
  }
};
