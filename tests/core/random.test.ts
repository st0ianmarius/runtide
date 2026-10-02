import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import {
  checkSeed,
  foldSeed,
  int,
  keyed,
  pick,
  roll,
  rollKey,
  shuffle,
  stream,
  weighted
} from '../../src/core/index.ts';

const draws = (random: () => number, n: number): number[] => Array.from({ length: n }, () => random());

describe('sequential streams', () => {
  it('hold the frozen table of their own draws', () => {
    // Mulberry32's outputs for fixed seeds, frozen: any change to the generator fails here.
    assert.deepEqual(
      draws(stream(0), 5),
      [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086]
    );
    assert.deepEqual(
      draws(stream(1), 5),
      [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]
    );
    assert.deepEqual(
      draws(stream(12345), 8),
      [
        0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061,
        0.34747186047025025, 0.07375754183158278, 0.7663964673411101
      ]
    );
  });

  it('seed from seed ^ salt, so a salted stream is the unsalted stream of the mixed seed', () => {
    assert.deepEqual(
      draws(stream(12345, 0x7219e5), 5),
      [0.75149060273543, 0.059921055333688855, 0.44655840983614326, 0.3468936122953892, 0.44077447173185647]
    );
    assert.deepEqual(
      draws(stream(12345, 0x5be115), 5),
      [0.5963826854713261, 0.9609864926896989, 0.629096802091226, 0.05504003423266113, 0.03500056732445955]
    );

    fc.assert(
      fc.property(fc.integer(), fc.integer(), (seed, salt) => {
        assert.deepEqual(draws(stream(seed, salt), 4), draws(stream(seed ^ salt), 4));
      })
    );
  });

  it('take seeds as 32-bit integers, signed or unsigned, and refuse any other', () => {
    assert.deepEqual(draws(stream(-7), 3), [0.43306733411736786, 0.32539576734416187, 0.5442695003002882]);
    assert.deepEqual(draws(stream(4_294_967_295), 3), [0.8964226141106337, 0.189478256739676, 0.7156526781618595]);
    assert.deepEqual(draws(stream(4_294_967_295), 3), draws(stream(-1), 3));
    assert.throws(() => stream(2.9), /seed is a 32-bit integer/);
    assert.throws(() => stream(1_760_000_000_000), /seed is a 32-bit integer/);
    assert.throws(() => stream(1, 2 ** 40), /salt is a 32-bit integer/);
  });

  it('combine seed and salt by XOR alone, so pairs with the same XOR draw alike', () => {
    assert.deepEqual(draws(stream(5, 3), 3), draws(stream(6, 0), 3));
    assert.deepEqual(draws(stream(100, 1), 3), draws(stream(101, 0), 3));
  });

  it('fold a wall-clock seed into 32 bits that checkSeed takes, and refuse NaN', () => {
    const now = 1_760_000_000_000;

    assert.equal(foldSeed(now), 3_358_376_345);
    assert.equal(checkSeed(foldSeed(now), 'seed'), 3_358_376_345);
    assert.equal(foldSeed(2 ** 32), 1, 'the high bits count');
    assert.equal(foldSeed(0xff_ff_ff_ff), 0xff_ff_ff_ff);
    assert.equal(foldSeed(7.9), 7);
    assert.notEqual(foldSeed(now), foldSeed(now + 1));
    assert.throws(() => foldSeed(Number.NaN), /finite number; got NaN/);
    assert.throws(() => foldSeed(Number.POSITIVE_INFINITY), RangeError);
    assert.throws(() => checkSeed(now, 'seed'), /seed is a 32-bit integer/);
  });

  it('draw the same sequence for the same seed and salt, always in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.nat({ max: 64 }), (seed, salt, n) => {
        const first = draws(stream(seed, salt), n);

        assert.deepEqual(draws(stream(seed, salt), n), first);
        assert.ok(first.every((value) => value >= 0 && value < 1));
      })
    );
  });

  it('keep two salted streams independent of each other', () => {
    const a = stream(12345, 0x7219e5);
    const b = stream(12345, 0x5be115);

    b();
    b();

    assert.equal(a(), 0.75149060273543);
  });
});

describe('integer helpers', () => {
  it('shuffle by Fisher-Yates from the end, n − 1 draws for n items', () => {
    assert.deepEqual(shuffle(stream(42), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), [0, 7, 3, 5, 2, 1, 8, 9, 4, 6]);

    // Draws of 0 swap every item with the first: [a, b, c, d] → [b, c, d, a].
    assert.deepEqual(
      shuffle(() => 0, ['a', 'b', 'c', 'd']),
      ['b', 'c', 'd', 'a']
    );
  });

  it('shuffle into a permutation of the same items', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.integer(), { maxLength: 30 }), (seed, items) => {
        const shuffled = shuffle(stream(seed), [...items]);

        assert.deepEqual(
          shuffled.toSorted((a, b) => a - b),
          items.toSorted((a, b) => a - b)
        );
      })
    );
  });

  it('draw integers as floor(random × n)', () => {
    const random = stream(42);

    assert.deepEqual(
      Array.from({ length: 6 }, () => int(random, 10)),
      [6, 4, 8, 6, 1, 5]
    );
  });

  it('pick weighted entries by walking one scaled draw down the list', () => {
    const random = stream(7);

    assert.deepEqual(
      Array.from({ length: 8 }, () => weighted(random, [1, 2, 3, 4])),
      [0, 0, 3, 3, 2, 2, 2, 1]
    );

    // A draw of 0.5 over weights [1, 2, 1] scales to 2: past the first (1), inside the second (1 + 2).
    assert.equal(
      weighted(() => 0.5, [1, 2, 1]),
      1
    );
  });

  it('never pick a weight that is not positive', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.integer({ min: -3, max: 5 }), { minLength: 1, maxLength: 8 }),
        (seed, w) => {
          const index = weighted(stream(seed), w);

          assert.ok(w.some((weight) => weight > 0) ? (w[index] ?? 0) > 0 : index === -1);
        }
      )
    );
  });

  it('skip non-positive weights and draw nothing when none is positive', () => {
    let calls = 0;

    const random = (): number => {
      calls += 1;

      return 0.99;
    };

    assert.equal(weighted(random, [0, 0]), -1);
    assert.equal(calls, 0);
    assert.equal(weighted(random, [1, 0, 1, 0]), 2);
    assert.equal(calls, 1);
  });

  it('pick from a list with one draw and refuse an empty list without drawing', () => {
    let calls = 0;

    const random = (): number => {
      calls += 1;

      return 0.5;
    };

    assert.equal(pick(random, ['a', 'b', 'c', 'd']), 'c');
    assert.throws(() => pick(random, []), RangeError);
    assert.equal(calls, 1);
  });

  it('draw the same count from a sequential stream and a keyed source', () => {
    const count = (random: () => number): number => {
      let calls = 0;

      const counted = (): number => {
        calls += 1;

        return random();
      };

      shuffle(counted, [1, 2, 3, 4, 5]);
      weighted(counted, [1, 2]);
      pick(counted, [1, 2]);
      int(counted, 3);

      return calls;
    };

    assert.equal(count(stream(1)), 7);
    assert.equal(count(keyed(1, 0, [3])), 7);
  });

  it('refuse, without drawing, an int range that is not a whole number from 1', () => {
    let calls = 0;

    const counted = (): number => {
      calls += 1;

      return 0.5;
    };

    for (const n of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => int(counted, n), /whole number from 1/);
    }

    assert.equal(calls, 0);
    assert.equal(int(counted, 1), 0);
  });
});

describe('keyed rolls', () => {
  it('hold the frozen table', () => {
    assert.deepEqual(
      [
        roll(0, 0),
        roll(1, 0),
        roll(0, 1),
        roll(12345, 0x7219e5, 60, 7, 3, 12, 0),
        roll(12345, 0x7219e5, 60, 7, 3, 12, 1),
        roll(12345, 0x5be115, 61, 7, 3, 12, 0),
        roll(-1, 4_294_967_295, -2_147_483_648),
        roll(42, 0, 1, 2, 3)
      ],
      [
        0.665013991529122, 0.0038770162500441074, 0.18112360499799252, 0.018563059624284506, 0.20127860317006707,
        0.9181832675822079, 0.5042357565835118, 0.8840016580652446
      ]
    );
  });

  it('hold the frozen table through the keyed helpers', () => {
    assert.deepEqual(shuffle(keyed(42, 0, [7, 9]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), [3, 5, 0, 4, 7, 6, 1, 9, 8, 2]);
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((i) => int(keyed(42, 0, [i]), 10)),
      [5, 9, 2, 9, 7, 6]
    );
  });

  it('depend only on the key, never on the rolls before them', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.nat(), { maxLength: 6 }), fc.nat({ max: 20 }), (seed, key, before) => {
        const first = roll(seed, 3, ...key);

        for (let i = 0; i < before; i++) {
          roll(seed, 3, i);
        }

        assert.equal(roll(seed, 3, ...key), first);
        assert.equal(rollKey(seed, 3, key), first);
      })
    );
  });

  it('stay in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.array(fc.integer()), (seed, salt, key) => {
        const value = roll(seed, salt, ...key);

        assert.ok(value >= 0 && value < 1);
      })
    );
  });

  it('change when any key part changes', () => {
    const base = roll(9, 1, 100, 5, 7);

    assert.notEqual(roll(10, 1, 100, 5, 7), base);
    assert.notEqual(roll(9, 2, 100, 5, 7), base);
    assert.notEqual(roll(9, 1, 101, 5, 7), base);
    assert.notEqual(roll(9, 1, 100, 5, 8), base);
    assert.notEqual(roll(9, 1, 100, 7, 5), base);
    assert.notEqual(roll(9, 1, 100, 5, 7, 0), base);
  });

  it('spread evenly over ten buckets', () => {
    const buckets = Array.from({ length: 10 }, () => 0);

    for (let hit = 0; hit < 20_000; hit++) {
      const bucket = Math.floor(roll(2024, 5, 600, hit) * 10);

      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }

    // Chi-square with 9 degrees of freedom stays below 27.88 (p = 0.001) for a uniform source.
    const chiSquare = buckets.reduce((sum, count) => sum + (count - 2000) ** 2 / 2000, 0);

    assert.ok(chiSquare < 27.88, `chi-square ${chiSquare}`);
  });

  it('reject key parts that are not 32-bit integers', () => {
    assert.throws(() => roll(1, 0, 0.5), RangeError);
    assert.throws(() => roll(1, 0, 4_294_967_296), RangeError);
    assert.throws(() => roll(1, 0, -2_147_483_649), RangeError);
    assert.throws(() => roll(Number.NaN, 0), RangeError);
  });
});
