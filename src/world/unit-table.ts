import type { Vec2 } from '../math/index.ts';

/** What a unit is added to a memory world with. */
export interface UnitSpec {
  /** Its entity id, which orders ties and keys rolls. */
  readonly id: number;

  /** Where it stands. */
  readonly at: Vec2;

  /** Its body radius; 0 by default. */
  readonly radius?: number;

  /** Its side (units of one side are allies); 0 by default. */
  readonly side?: number;
}

/** A column of numbers per slot, grown by doubling so it keeps one typed array between growths. */
class Column {
  values: Float64Array;

  constructor(capacity: number) {
    this.values = new Float64Array(capacity);
  }

  /** Makes room for `size` slots, keeping what is stored. */
  fit(size: number): void {
    if (size > this.values.length) {
      const grown = new Float64Array(Math.max(size, this.values.length * 2));

      grown.set(this.values);
      this.values = grown;
    }
  }
}

/**
 * The units of a memory world as struct-of-arrays columns by slot (§I.5.4): positions now and at the start of the
 * tick, radii, sides and ids in typed arrays, the unit objects beside them, and a map from unit to slot. A removed
 * unit's slot is reused.
 */
export class UnitTable<Unit> {
  /** The unit in each slot; `undefined` for a free slot. */
  readonly units: (Unit | undefined)[] = [];

  readonly #x = new Column(64);
  readonly #z = new Column(64);
  readonly #px = new Column(64);
  readonly #pz = new Column(64);
  readonly #radius = new Column(64);
  readonly #side = new Column(64);
  readonly #id = new Column(64);
  readonly #slots = new Map<Unit, number>();
  readonly #free: number[] = [];

  /** How many slots exist, free ones included: every live slot is below it. */
  get span(): number {
    return this.units.length;
  }

  /** How many units there are. */
  get size(): number {
    return this.#slots.size;
  }

  /** The current x of each slot. */
  get x(): Float64Array {
    return this.#x.values;
  }

  /** The current z of each slot. */
  get z(): Float64Array {
    return this.#z.values;
  }

  /** The x at the start of the tick of each slot. */
  get px(): Float64Array {
    return this.#px.values;
  }

  /** The z at the start of the tick of each slot. */
  get pz(): Float64Array {
    return this.#pz.values;
  }

  /** The body radius of each slot. */
  get radius(): Float64Array {
    return this.#radius.values;
  }

  /** The side of each slot. */
  get side(): Float64Array {
    return this.#side.values;
  }

  /** The entity id of each slot. */
  get id(): Float64Array {
    return this.#id.values;
  }

  /** Adds a unit and returns its slot; throws when it is already here. */
  add(unit: Unit, spec: UnitSpec): number {
    if (this.#slots.has(unit)) {
      throw new RangeError(`Unit ${spec.id} is already in the world.`);
    }

    const slot = this.#free.pop() ?? this.units.length;

    for (const column of [this.#x, this.#z, this.#px, this.#pz, this.#radius, this.#side, this.#id]) {
      column.fit(slot + 1);
    }

    this.units[slot] = unit;
    this.#slots.set(unit, slot);
    this.x[slot] = spec.at.x;
    this.z[slot] = spec.at.z;
    this.px[slot] = spec.at.x;
    this.pz[slot] = spec.at.z;
    this.radius[slot] = spec.radius ?? 0;
    this.side[slot] = spec.side ?? 0;
    this.id[slot] = spec.id;

    return slot;
  }

  /** Removes a unit and returns its old slot, or -1 when it was not here. */
  remove(unit: Unit): number {
    const slot = this.#slots.get(unit);

    if (slot === undefined) {
      return -1;
    }

    this.#slots.delete(unit);
    this.units[slot] = undefined;
    this.#free.push(slot);

    return slot;
  }

  /** A unit's slot, or -1 when it is not here. */
  find(unit: Unit): number {
    return this.#slots.get(unit) ?? -1;
  }

  /** A unit's slot; throws when it is not here. */
  slotOf(unit: Unit): number {
    const slot = this.#slots.get(unit);

    if (slot === undefined) {
      throw new RangeError('The unit is not in the world.');
    }

    return slot;
  }
}
