import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ShapePlacer } from '../../src/area-triggers/shape-placer.ts';
import {
  circle,
  cone,
  covers,
  difference,
  lane,
  outside,
  point,
  polygon,
  ring,
  type Shape,
  union,
  vec2
} from '../../src/math/index.ts';
import { makeSpellGame } from '../helpers/spell-game.ts';

/** Where every shape here is placed: (10, 10), facing +x, so a template's +z runs along +x and its +x along -z. */
const AT = vec2(10, 10);
const HEADING = Math.PI / 2;

/** Asserts which points a shape covers and which it does not. */
const checkCovers = (shape: Shape, inside: readonly [number, number][], outsidePoints: readonly [number, number][]) => {
  for (const [x, z] of inside) {
    assert.equal(covers(shape, vec2(x, z)), true, `covers (${x}, ${z})`);
  }

  for (const [x, z] of outsidePoints) {
    assert.equal(covers(shape, vec2(x, z)), false, `does not cover (${x}, ${z})`);
  }
};

/** Two discs ahead of and behind the pose, the one ahead with its middle cut out, all turned inside out. */
const nested = (): Shape =>
  outside(difference(union(circle(1, vec2(0, 2)), circle(1, vec2(0, -2))), circle(0.5, vec2(0, 2))));

describe('ShapePlacer', () => {
  it('holds a point at the origin before its first placement', () => {
    const placer = new ShapePlacer();

    assert.equal(placer.shape.kind, 'point');
    assert.ok(placer.shape.kind === 'point');
    assert.deepEqual(placer.shape.at, { x: 0, z: 0 });
  });

  it('turns and moves a point', () => {
    const placed = new ShapePlacer().place(point(vec2(1, 2)), AT, HEADING);

    assert.ok(placed.kind === 'point');
    assert.deepEqual(placed.at, { x: 12, z: 9 });
  });

  it('turns and moves a ring, keeping its radii', () => {
    const placer = new ShapePlacer();
    const placed = placer.place(ring(1, 2, vec2(0, 3)), AT, HEADING);

    assert.equal(placer.shape, placed);
    assert.ok(placed.kind === 'ring');
    assert.deepEqual([placed.at, placed.inner, placed.outer], [{ x: 13, z: 10 }, 1, 2]);
    checkCovers(
      placed,
      [
        [14.5, 10],
        [13, 8.5]
      ],
      [
        [13, 10],
        [10, 14.5]
      ]
    );
  });

  it('turns and moves a cone, adding the heading to its own', () => {
    const placed = new ShapePlacer().place(
      cone({ r: 3, half: 0.5, dir: 0.25, at: vec2(1, 0), apex: 0.5 }),
      AT,
      HEADING
    );

    assert.ok(placed.kind === 'cone');
    assert.deepEqual(
      [placed.at, placed.r, placed.half, placed.dir, placed.apex],
      [{ x: 10, z: 9 }, 3, 0.5, 1.8207963267948966, 0.5]
    );
    checkCovers(
      placed,
      [
        [12, 8.5],
        [10, 9.4]
      ],
      [
        [10, 11],
        [12, 10.5],
        [10, 8]
      ]
    );
  });

  it('turns and moves every corner of a polygon, keeping its band', () => {
    const placed = new ShapePlacer().place(
      polygon([vec2(-1, 1), vec2(1, 1), vec2(1, 3), vec2(-1, 3)], 0.5),
      AT,
      HEADING
    );

    assert.ok(placed.kind === 'polygon');
    assert.deepEqual(placed.points, [
      { x: 11, z: 11 },
      { x: 11, z: 9 },
      { x: 13, z: 9 },
      { x: 13, z: 11 }
    ]);
    assert.equal(placed.band, 0.5);
    checkCovers(
      placed,
      [
        [12, 10],
        [13.25, 10]
      ],
      [
        [10, 12],
        [13.75, 10]
      ]
    );
  });

  it('places the shape inside an outside', () => {
    const placed = new ShapePlacer().place(outside(circle(1, vec2(0, 2))), AT, HEADING);

    assert.ok(placed.kind === 'outside');
    assert.ok(placed.shape.kind === 'circle');
    assert.deepEqual(placed.shape.at, { x: 12, z: 10 });
    checkCovers(placed, [[10, 12]], [[12, 10]]);
  });

  it('places every part of a union', () => {
    const placed = new ShapePlacer().place(
      union(circle(1, vec2(0, 2)), lane({ length: 2, width: 1, dir: 0, at: vec2(1, 0) })),
      AT,
      HEADING
    );

    assert.ok(placed.kind === 'union');
    assert.deepEqual(
      placed.shapes.map((part) => part.kind),
      ['circle', 'lane']
    );
    checkCovers(
      placed,
      [
        [12, 10],
        [11, 9]
      ],
      [
        [10, 12],
        [11, 11]
      ]
    );
  });

  it('places both sides of a difference', () => {
    const placed = new ShapePlacer().place(difference(circle(3), circle(1, vec2(0, 2))), AT, HEADING);

    assert.ok(placed.kind === 'difference');
    assert.ok(placed.base.kind === 'circle' && placed.minus.kind === 'circle');
    assert.deepEqual([placed.base.at, placed.minus.at], [AT, { x: 12, z: 10 }]);
    checkCovers(
      placed,
      [
        [10, 12],
        [8, 10]
      ],
      [
        [12, 10],
        [13.5, 10]
      ]
    );
  });

  it('places nested compounds all the way down', () => {
    const placed = new ShapePlacer().place(nested(), AT, HEADING);

    checkCovers(
      placed,
      [
        [12, 10],
        [10, 10],
        [10, 12],
        [10, 8]
      ],
      [
        [12.75, 10],
        [8, 10]
      ]
    );
  });

  it('rewrites the same records when the same template is placed again', () => {
    const placer = new ShapePlacer();

    const template = union(
      ring(1, 2, vec2(0, 3)),
      difference(circle(3), polygon([vec2(0, 0), vec2(1, 0), vec2(0, 1)]))
    );

    const first = placer.place(template, AT, HEADING);

    assert.ok(first.kind === 'union');
    const [ringPart, cut] = first.shapes;

    assert.ok(ringPart?.kind === 'ring' && cut?.kind === 'difference' && cut.minus.kind === 'polygon');
    const { at } = ringPart;
    const corners = cut.minus.points;
    const corner = corners[1];

    const second = placer.place(template, vec2(-5, 2), 0);

    assert.equal(second, first);
    assert.equal(placer.shape, first);
    assert.ok(second.kind === 'union');
    assert.equal(second.shapes, first.shapes);
    assert.equal(second.shapes[0], ringPart);
    assert.equal(second.shapes[1], cut);
    assert.equal(ringPart.at, at);
    assert.equal(cut.minus.points, corners);
    assert.equal(cut.minus.points[1], corner);
    assert.deepEqual(ringPart.at, { x: -5, z: 5 });
    assert.deepEqual(corner, { x: -4, z: 2 });
    checkCovers(
      second,
      [
        [-5, 6.5],
        [-7, 2]
      ],
      [
        [-5, 5],
        [8, 13]
      ]
    );
  });

  it('builds a new copy for a new template, and again on going back to the first', () => {
    const placer = new ShapePlacer();
    const first = union(circle(1, vec2(0, 2)), circle(1, vec2(0, -2)));
    const placedFirst = placer.place(first, AT, HEADING);
    const placedNested = placer.place(nested(), AT, HEADING);

    assert.notEqual(placedNested, placedFirst);
    assert.equal(placer.shape, placedNested);
    checkCovers(placedNested, [[12, 10]], [[12.75, 10]]);

    const placedAgain = placer.place(first, vec2(0, 0), 0);

    assert.notEqual(placedAgain, placedFirst);
    assert.ok(placedAgain.kind === 'union');
    checkCovers(
      placedAgain,
      [
        [0, 2],
        [0, -2]
      ],
      [
        [2, 0],
        [12, 10]
      ]
    );
    assert.equal(placer.place(first, AT, HEADING), placedAgain);
    checkCovers(placedAgain, [[12, 10]], [[0, 2]]);
  });

  it('builds a new copy for an equal template that is a new object', () => {
    const placer = new ShapePlacer();
    const placed = placer.place(nested(), AT, HEADING);

    assert.notEqual(placer.place(nested(), AT, HEADING), placed);
  });

  it('forgets its template on clear, then places afresh', () => {
    const placer = new ShapePlacer();
    const template = difference(circle(3), cone({ r: 2, half: 0.5, dir: 0 }));
    const placed = placer.place(template, AT, HEADING);

    placer.clear();
    assert.ok(placer.shape.kind === 'point');
    assert.deepEqual(placer.shape.at, { x: 0, z: 0 });

    const again = placer.place(template, AT, HEADING);

    assert.notEqual(again, placed);
    assert.equal(placer.shape, again);
    checkCovers(
      again,
      [
        [10, 12],
        [8, 10]
      ],
      [
        [11.5, 10],
        [10, 13.5]
      ]
    );
  });
});

describe('ShapePlacer driven by an area trigger', () => {
  it('places a new compound from the shape function each frame', () => {
    let cut = false;

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          field: {
            shape: () =>
              cut
                ? difference(circle(3), ring(0, 1, vec2(0, 2)))
                : union(circle(1, vec2(0, 2)), polygon([vec2(-1, -1), vec2(1, -1), vec2(0, -3)])),
            lifetime: 10
          }
        }
      }
    );

    const handle = game.areaTriggers.spawn(game.areaId.field, { owner: game.unit(1), at: AT, heading: HEADING });
    const area = game.areaTriggers.get(handle);

    assert.ok(area !== undefined);
    assert.equal(area.shape.kind, 'union');
    checkCovers(
      area.shape,
      [
        [12, 10],
        [8, 10]
      ],
      [
        [10, 12],
        [10, 10.5]
      ]
    );

    cut = true;
    game.step();
    game.areaTriggers.step();
    assert.equal(area.shape.kind, 'difference');
    checkCovers(
      area.shape,
      [
        [8, 10],
        [10, 12]
      ],
      [
        [12, 10],
        [13.5, 10]
      ]
    );
  });
});
