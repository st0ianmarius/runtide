import type { Shape } from './shapes.ts';
import { hypot, type Vec2 } from './vec2.ts';

/**
 * The shares along a segment where a moving point may cross a shape's boundary, gathered from every curve that bounds
 * what `covers` covers (circles, and lines offset by the body's reach). A superset is harmless: the caller tests the
 * pieces between them with `covers` itself, so only a missing candidate would matter.
 */
export class PathCandidates {
  /** The shares found, valid up to `count`, each in `(0, 1)`. */
  readonly shares: number[] = [];

  /** How many shares were found. */
  count = 0;

  #from: Vec2 = { x: 0, z: 0 };
  #to: Vec2 = { x: 0, z: 0 };

  /** Gathers the candidates of `shape` for a body reaching `margin` along a segment, forgetting the last ones. */
  gather(shape: Shape, [from, to]: readonly [Vec2, Vec2], margin: number): void {
    this.count = 0;
    this.#from = from;
    this.#to = to;
    this.#collect(shape, margin);
  }

  /** Adds a share when it lies strictly inside the segment. */
  #add(t: number): void {
    if (t > 0 && t < 1) {
      this.shares[this.count] = t;
      this.count += 1;
    }
  }

  /**
   * The shares where the moving point is exactly `r` from `(cx, cz)`. The discriminant is taken from the line's
   * distance to the centre (`a·r² − (o × d)²`, equal to `b² − a(o·o − r²)`), which keeps a circle far smaller than
   * its distance from the start (a ring's inner rim less the body's reach) from cancelling away.
   */
  #circle(cx: number, cz: number, r: number): void {
    if (!(r > 0)) {
      return;
    }

    const from = this.#from;
    const dx = this.#to.x - from.x;
    const dz = this.#to.z - from.z;
    const ox = from.x - cx;
    const oz = from.z - cz;
    const a = dx * dx + dz * dz;
    const b = ox * dx + oz * dz;
    const cross = ox * dz - oz * dx;
    const discriminant = a * r * r - cross * cross;

    if (a <= 0 || discriminant < 0) {
      return;
    }

    const root = Math.sqrt(discriminant);

    this.#add((-b - root) / a);
    this.#add((-b + root) / a);
  }

  /** The share where the moving point crosses the line of points `p` with `n · p = c`. */
  #line(nx: number, nz: number, c: number): void {
    const d0 = nx * this.#from.x + nz * this.#from.z - c;
    const d1 = nx * this.#to.x + nz * this.#to.z - c;

    if (d0 !== d1) {
      this.#add(d0 / (d0 - d1));
    }
  }

  /** A line and its two offsets by `reach`, one on each side. */
  #band(nx: number, nz: number, [c, reach]: readonly [number, number]): void {
    this.#line(nx, nz, c);

    if (reach !== 0) {
      this.#line(nx, nz, c + reach);
      this.#line(nx, nz, c - reach);
    }
  }

  /** A cone's candidates: its rim, its apex circles (bare and grown by the reach), and each edge with its offsets. */
  #cone(shape: Extract<Shape, { kind: 'cone' }>, margin: number): void {
    const { at } = shape;

    this.#circle(at.x, at.z, shape.r + margin);
    this.#circle(at.x, at.z, shape.apex);
    this.#circle(at.x, at.z, shape.apex + margin);
    this.#circle(at.x, at.z, Math.abs(margin));

    for (const heading of [shape.dir - shape.half, shape.dir + shape.half]) {
      const nx = Math.cos(heading);
      const nz = -Math.sin(heading);

      this.#band(nx, nz, [nx * at.x + nz * at.z, margin]);
    }
  }

  /** A lane's candidates: its four sides, pushed out by the margin. */
  #lane(shape: Extract<Shape, { kind: 'lane' }>, margin: number): void {
    const sin = Math.sin(shape.dir);
    const cos = Math.cos(shape.dir);
    const along = sin * shape.at.x + cos * shape.at.z;
    const across = cos * shape.at.x - sin * shape.at.z;
    const half = shape.width / 2 + margin;

    this.#line(sin, cos, along - shape.back - margin);
    this.#line(sin, cos, along + shape.length + margin);
    this.#line(cos, -sin, across - half);
    this.#line(cos, -sin, across + half);
  }

  /** A polygon's candidates: every edge with its offsets by the reach, and a circle of the reach at every corner. */
  #polygon(shape: Extract<Shape, { kind: 'polygon' }>, margin: number): void {
    const reach = shape.band + margin;
    let a = shape.points.at(-1);

    for (const b of shape.points) {
      if (a !== undefined) {
        const length = hypot(b.x - a.x, b.z - a.z);

        if (length > 0) {
          const nx = -(b.z - a.z) / length;
          const nz = (b.x - a.x) / length;

          this.#band(nx, nz, [nx * a.x + nz * a.z, reach]);
        }
      }

      this.#circle(b.x, b.z, Math.abs(reach));
      a = b;
    }
  }

  /** Collects the candidates of any shape; complements and cuts turn the margin around, as `covers` does. */
  #collect(shape: Shape, margin: number): void {
    switch (shape.kind) {
      case 'point':
        this.#circle(shape.at.x, shape.at.z, margin);
        break;
      case 'circle':
        this.#circle(shape.at.x, shape.at.z, shape.r + margin);
        break;
      case 'ring':
        this.#circle(shape.at.x, shape.at.z, shape.outer + margin);
        this.#circle(shape.at.x, shape.at.z, shape.inner - margin);
        break;
      case 'cone':
        this.#cone(shape, margin);
        break;
      case 'lane':
        this.#lane(shape, margin);
        break;
      case 'polygon':
        this.#polygon(shape, margin);
        break;
      case 'outside':
        this.#collect(shape.shape, -margin);
        break;
      case 'union':
        for (const part of shape.shapes) {
          this.#collect(part, margin);
        }

        break;
      case 'difference':
        this.#collect(shape.base, margin);
        this.#collect(shape.minus, -margin);
        break;
    }
  }
}
