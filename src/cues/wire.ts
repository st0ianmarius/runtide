/**
 * Where encoded cues go (§I.6: the params' wire encoding, transport-agnostic): three kinds of number, which a writer
 * turns into bytes (`createByteWriter`) or keeps as a plain number array for a transport that packs its own
 * (`createNumberWriter`, for msgpack or JSON). A game may write its own header through the same writer.
 */
export interface CueWriter {
  /** Writes a whole number from 0 (a safe integer). */
  readonly uint: (value: number) => void;

  /** Writes a whole number of either sign (a safe integer, at most 2⁵¹ in size). */
  readonly int: (value: number) => void;

  /** Writes a float32. */
  readonly f32: (value: number) => void;
}

/** Where encoded cues are read from: the reader matching a writer. Each read throws a `RangeError` past the end. */
export interface CueReader {
  /** Reads a whole number from 0. */
  readonly uint: () => number;

  /** Reads a whole number of either sign. */
  readonly int: () => number;

  /** Reads a float32. */
  readonly f32: () => number;

  /** How many units (bytes, or numbers) are left: what a length read from the data is checked against. */
  readonly remaining: () => number;
}

/** A writer into a growing byte array: unsigned LEB128 varints, zigzag for signed ones, little-endian float32. */
export interface ByteWriter extends CueWriter {
  /** How many bytes are written. */
  readonly length: number;

  /** A view of the bytes written, valid until the next write or `reset`. */
  readonly bytes: () => Uint8Array;

  /** Forgets what was written, keeping the storage. */
  readonly reset: () => void;
}

/** A writer into a plain number array: one whole number per `uint` or `int` (zigzag-free), one float per `f32`. */
export interface NumberWriter extends CueWriter {
  /** How many numbers are written. */
  readonly length: number;

  /** A copy of the numbers written. */
  readonly numbers: () => number[];

  /** Forgets what was written, keeping the storage. */
  readonly reset: () => void;
}

/** Throws: the data ended, or held a number that cannot be one. */
const corrupt = (problem: string): never => {
  throw new RangeError(`Cue data ${problem}.`);
};

/** The zigzag form of a signed whole number: 0, −1, 1, −2 … become 0, 1, 2, 3 … */
const zigzag = (value: number): number => (value >= 0 ? value * 2 : -value * 2 - 1) + 0;

/** The signed whole number behind a zigzag form. */
const unzigzag = (value: number): number => (value % 2 === 0 ? value / 2 : -(value + 1) / 2) + 0;

/**
 * A byte writer's state. A class, so its instances keep fast properties (an object literal with a getter does not);
 * its functions are arrow fields, so they work detached.
 */
class BytesOut implements ByteWriter {
  #bytes: Uint8Array;
  #view: DataView;
  #length = 0;

  constructor(capacity: number) {
    this.#bytes = new Uint8Array(Math.max(16, capacity));
    this.#view = new DataView(this.#bytes.buffer);
  }

  get length(): number {
    return this.#length;
  }

  readonly uint = (value: number): void => {
    let rest = value;
    const into = this.#reserve(8);
    let at = this.#length;

    // Past 32 bits the shifts below would wrap, so the high groups go by division first.
    while (rest > 0xff_ff_ff_ff) {
      into[at] = (rest % 128) + 128;
      at += 1;
      rest = Math.floor(rest / 128);
    }

    while (rest > 127) {
      into[at] = (rest & 127) | 128;
      at += 1;
      rest >>>= 7;
    }

    into[at] = rest;
    this.#length = at + 1;
  };

  readonly int = (value: number): void => {
    this.uint(zigzag(value));
  };

  readonly f32 = (value: number): void => {
    this.#reserve(4);
    this.#view.setFloat32(this.#length, value, true);
    this.#length += 4;
  };

  readonly bytes = (): Uint8Array => this.#bytes.subarray(0, this.#length);

  readonly reset = (): void => {
    this.#length = 0;
  };

  /** Makes room for `count` more bytes and returns the storage. */
  #reserve(count: number): Uint8Array {
    if (this.#length + count > this.#bytes.length) {
      const grown = new Uint8Array(Math.max(this.#bytes.length * 2, this.#length + count));

      grown.set(this.#bytes.subarray(0, this.#length));
      this.#bytes = grown;
      this.#view = new DataView(grown.buffer);
    }

    return this.#bytes;
  }
}

/** Creates an empty byte writer, with room for `capacity` bytes before it first grows. */
export const createByteWriter = (capacity = 256): ByteWriter => new BytesOut(capacity);

/** Creates a reader over bytes a `ByteWriter` wrote. */
export const createByteReader = (bytes: Uint8Array): CueReader => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;

  const uint = (): number => {
    let value = 0;
    let weight = 1;

    for (;;) {
      const byte = bytes[at] ?? corrupt('ended in a number');

      at += 1;
      value += (byte % 128) * weight;

      if (byte < 128) {
        return value;
      }

      weight *= 128;

      if (weight > 2 ** 53) {
        corrupt('held a number past the safe range');
      }
    }
  };

  return {
    uint,
    int: () => unzigzag(uint()),

    f32: () => {
      if (at + 4 > bytes.length) {
        corrupt('ended in a float');
      }

      const value = view.getFloat32(at, true);

      at += 4;

      return value;
    },

    remaining: () => bytes.length - at,
  };
};

/** A number writer's state: a class for fast properties, its functions arrow fields so they work detached. */
class NumbersOut implements NumberWriter {
  readonly #values: number[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  readonly uint = (value: number): void => {
    this.#values[this.#length] = value;
    this.#length += 1;
  };

  readonly int = this.uint;

  readonly f32 = (value: number): void => {
    this.uint(Math.fround(value));
  };

  readonly numbers = (): number[] => this.#values.slice(0, this.#length);

  readonly reset = (): void => {
    this.#length = 0;
  };
}

/** Creates an empty number writer. */
export const createNumberWriter = (): NumberWriter => new NumbersOut();

/** Creates a reader over numbers a `NumberWriter` wrote; a whole number read that is not one is refused. */
export const createNumberReader = (values: readonly number[]): CueReader => {
  let at = 0;

  const next = (): number => {
    const value = values[at] ?? corrupt('ended');

    at += 1;

    return value;
  };

  const whole = (value: number, least: number): number =>
    Number.isSafeInteger(value) && value >= least ? value + 0 : corrupt(`held ${value} where a whole number goes`);

  return {
    uint: () => whole(next(), 0),
    int: () => whole(next(), -Number.MAX_SAFE_INTEGER),
    f32: () => Math.fround(next()),

    remaining: () => values.length - at,
  };
};
