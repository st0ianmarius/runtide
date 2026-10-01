import type { Vec2 } from '../math/index.ts';
import { IdSlots } from './id-slots.ts';

/** What a unit is added to a memory world with. */
export interface UnitSpec {
  /** Its entity id, a whole number from 0 below 2³², which orders ties and keys rolls. */
  readonly id: number;

  /** Where it stands. */
  readonly at: Vec2;

  /** Its body radius; 0 by default. */
  readonly radius?: number;

  /** Its side (units of one side are allies); 0 by default. */
  readonly side?: number;
}

/**
 * Throws unless a position is finite: a NaN or infinite one never lands in a query, and its motion would make every
 * relative sweep of the tick reach nothing.
 */
export const checkPosition = (at: Vec2, id: number): void => {
  if (!(Number.isFinite(at.x) && Number.isFinite(at.z))) {
    throw new RangeError(`Unit ${id} is placed at a finite position; got (${at.x}, ${at.z}).`);
  }
};

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
 * Where a world keeps each unit's slot on the unit itself (a field the game gives it), so finding a unit's slot is one
 * read, with no map or id table: `{ get: (unit) => unit.worldSlot, set: (unit, slot) => { unit.worldSlot = slot } }`.
 * A unit not in the world reads -1; its field starts at -1.
 */
export interface WorldSlots<Unit> {
  /** The slot a unit was given, or -1. */
  readonly get: (unit: Unit) => number;

  /** Keeps a unit's slot (-1 as it leaves). */
  readonly set: (unit: Unit, slot: number) => void;
}

/**
 * The units of a memory world as struct-of-arrays columns by slot: positions now and at the start of the
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
  readonly #columns: readonly Column[] = [this.#x, this.#z, this.#px, this.#pz, this.#radius, this.#side, this.#id];
  readonly #slots = new Map<Unit, number>();
  readonly #free: number[] = [];

  /** The game's entity id of a unit, when it gave one: slots are then found by id, not by the unit object. */
  readonly #idOf: ((unit: Unit) => number) | undefined;
  readonly #byId = new IdSlots();
  #count = 0;

  readonly #keep: WorldSlots<Unit> | undefined;

  constructor(idOf?: (unit: Unit) => number, keep?: WorldSlots<Unit>) {
    this.#idOf = idOf;
    this.#keep = keep;
  }

  /** How many slots exist, free ones included: every live slot is below it. */
  get span(): number {
    return this.units.length;
  }

  /** How many units there are. */
  get size(): number {
    return this.#count;
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
    this.#checkNew(unit, spec.id);
    this.#checkBody(spec);

    const slot = this.#free.pop() ?? this.units.length;

    for (const column of this.#columns) {
      column.fit(slot + 1);
    }

    this.units[slot] = unit;
    this.#count += 1;
    this.#keep?.set(unit, slot);

    if (this.#idOf === undefined) {
      this.#slots.set(unit, slot);
    } else {
      this.#byId.set(spec.id, slot);
    }

    this.x[slot] = spec.at.x;
    this.z[slot] = spec.at.z;
    this.px[slot] = spec.at.x;
    this.pz[slot] = spec.at.z;
    this.radius[slot] = spec.radius ?? 0;
    this.side[slot] = spec.side ?? 0;
    this.id[slot] = spec.id;

    return slot;
  }

  /** Throws unless a unit may come in under an id: a whole id its `idOf` gives, neither already here. */
  #checkNew(unit: Unit, id: number): void {
    if (!(Number.isInteger(id) && id >= 0 && id < 2 ** 32)) {
      throw new RangeError(`A unit's entity id is a whole number from 0 below 2^32; got ${id}.`);
    }

    const idOf = this.#idOf;

    if (idOf !== undefined && idOf(unit) !== id) {
      throw new RangeError(`Unit ${id} is added under an id its idOf does not give (${idOf(unit)}).`);
    }

    if (this.find(unit) >= 0 || (idOf !== undefined && this.#byId.get(id) >= 0)) {
      throw new RangeError(`Unit ${id} is already in the world.`);
    }
  }

  /** Throws unless a new unit's position is finite and its radius a finite number from 0. */
  #checkBody(spec: UnitSpec): void {
    checkPosition(spec.at, spec.id);

    const radius = spec.radius ?? 0;

    if (!(Number.isFinite(radius) && radius >= 0)) {
      throw new RangeError(`Unit ${spec.id} has a body radius that is a finite number from 0; got ${radius}.`);
    }
  }

  /** Removes a unit and returns its old slot, or -1 when it was not here. */
  remove(unit: Unit): number {
    const slot = this.find(unit);

    if (slot < 0) {
      return -1;
    }

    if (this.#idOf === undefined) {
      this.#slots.delete(unit);
    } else {
      this.#byId.delete(this.id[slot] ?? -1);
    }

    this.#count -= 1;
    this.units[slot] = undefined;
    this.#free.push(slot);
    this.#keep?.set(unit, -1);

    return slot;
  }

  /** A unit's slot, or -1 when it is not here. */
  find(unit: Unit): number {
    const keep = this.#keep;

    if (keep !== undefined) {
      const kept = keep.get(unit);

      return kept >= 0 && this.units[kept] === unit ? kept : -1;
    }

    const idOf = this.#idOf;

    if (idOf === undefined) {
      return this.#slots.get(unit) ?? -1;
    }

    const slot = this.#byId.get(idOf(unit));

    return slot >= 0 && this.units[slot] === unit ? slot : -1;
  }

  /** A unit's slot; throws when it is not here. */
  slotOf(unit: Unit): number {
    const slot = this.find(unit);

    if (slot < 0) {
      throw new RangeError('The unit is not in the world.');
    }

    return slot;
  }
}
