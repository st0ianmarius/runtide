import type { Vec2 } from '../math/index.ts';

/** What a movement intent asks: nothing, stand still, go toward a unit or a point, keep a distance, or run from one. */
export type MoveKind = 'none' | 'hold' | 'chase' | 'point' | 'keepRange' | 'flee';

/** Where a movement intent faces: where it moves, its target unit, its point, or where it faces now. */
export type FaceKind = 'move' | 'target' | 'point' | 'keep';

/**
 * A unit's movement intent (§II.6 C9, §I.7.1 F17): what its brain wants, written each think into this one reused
 * record (no allocation per unit per tick) and read by the game's own movement, which steers, paths and collides.
 * Charges, leaps and knockbacks are motion a spell or a force drives, not intents.
 */
export class MoveIntent {
  /** What it asks. */
  kind: MoveKind = 'none';

  /** The entity id of the unit it chases, keeps range from or flees; −1 for none. */
  target = -1;

  /** The point it goes to, or flees from when it has no target unit. */
  readonly point = { x: 0, z: 0 };

  /** The distance it stops at (`chase`, `point`) or keeps (`keepRange`, `flee`). */
  distance = 0;

  /** Its speed, as a factor of the unit's own; 1 by default. */
  speed = 1;

  /** Where it faces. */
  face: FaceKind = 'move';

  /** The fastest it turns, in radians a second; unlimited by default. */
  turnRate = Number.POSITIVE_INFINITY;

  /** Asks nothing: the game's movement does what it does by default. */
  clear(): this {
    return this.#set('none', -1);
  }

  /** Stands still, facing as it faces now unless told otherwise. */
  hold(): this {
    this.#set('hold', -1);
    this.face = 'keep';

    return this;
  }

  /** Goes toward a unit until `distance` from it, facing it. */
  chase(target: number, distance = 0): this {
    this.#set('chase', target);
    this.distance = distance;
    this.face = 'target';

    return this;
  }

  /** Goes to a point until `distance` from it. */
  moveTo(point: Vec2, distance = 0): this {
    this.#set('point', -1);
    this.#place(point);
    this.distance = distance;

    return this;
  }

  /** Stays `distance` from a unit: closer in when farther, backing off when nearer, facing it. */
  keepRange(target: number, distance: number): this {
    this.#set('keepRange', target);
    this.distance = distance;
    this.face = 'target';

    return this;
  }

  /** Runs from a unit until `distance` from it. */
  flee(target: number, distance: number): this {
    this.#set('flee', target);
    this.distance = distance;

    return this;
  }

  /** Runs from a point until `distance` from it. */
  fleePoint(point: Vec2, distance: number): this {
    this.#set('flee', -1);
    this.#place(point);
    this.distance = distance;

    return this;
  }

  /** Resets the fields every kind shares, then sets the kind and the target. */
  #set(kind: MoveKind, target: number): this {
    this.kind = kind;
    this.target = target;
    this.distance = 0;
    this.speed = 1;
    this.face = 'move';
    this.turnRate = Number.POSITIVE_INFINITY;

    return this;
  }

  /** Copies a point into the intent's own. */
  #place(point: Vec2): void {
    this.point.x = point.x;
    this.point.z = point.z;
  }
}
