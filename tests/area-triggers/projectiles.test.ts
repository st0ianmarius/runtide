import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AnyAreaTriggerDef,
  type AreaTriggerContext,
  defineAreaTrigger,
  fanHeading,
  pursue,
  pursueUnit,
  retarget
} from '../../src/area-triggers/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { type Game, makeSpellGame } from '../helpers/spell-game.ts';

/** Steps a game's clock and its area triggers `count` times. */
const ticks = (game: ReturnType<typeof makeSpellGame>, count: number): void => {
  for (let i = 0; i < count; i++) {
    game.step();
    game.areaTriggers.step();
  }
};

/** A probe that lives a while, with a `chain` ledger, and runs `init` once it has spawned. */
const probe = (def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
  shape: circle(0.5),
  lifetime: 5,
  ledgers: { chain: { policy: 'once' } },
  ...def
});

/** The test game's area trigger kinds, their state inferred. */
const glaive = defineAreaTrigger<Game>();

/** A position, as the log writes it. */
const at = (c: AreaTriggerContext<Game>): string => `${c.position.x.toFixed(2)},${c.position.z.toFixed(2)}`;

describe('retarget', () => {
  it('finds the nearest unit in reach on its side, leaving out what its ledger recorded and what it excludes', () => {
    const found: (number | undefined)[] = [];
    const units: Game['bearer'][] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          probe: probe({
            init: (c) => {
              const from = vec2(0, 0);

              const next = (options: Parameters<typeof retarget<Game>>[2]) =>
                found.push(retarget(c, from, options)?.id);

              next({ range: 5 });
              next({ range: 5, side: 'allies' });
              const [first, second] = units;

              c.ledger('chain').record(first ?? c.owner);
              next({ range: 5, ledger: 'chain' });
              next({ range: 5, ledger: 'chain', exclude: new Set([second]) });
              next({ range: 5, filter: (unit) => unit.id !== 100 && unit.id !== 101 });
              found.push(retarget(c, vec2(9, 0), { range: 2 })?.id);
            }
          })
        }
      }
    );

    const owner = game.unit(1);

    for (const [id, x] of [
      [100, 2],
      [101, 3],
      [102, 10],
      [2, 1]
    ] as const) {
      const unit = game.unit(id);

      game.place(unit, vec2(x, 0));
      units.push(unit);
    }

    game.place(owner, vec2(0, 0));
    game.areaTriggers.spawn(game.areaId.probe, { owner, at: vec2(0, 0) });
    assert.deepEqual(found, [100, 1, 101, undefined, undefined, 102]);
  });
});

describe('pursue', () => {
  it('goes its step toward a point, or stops on it and returns the travel left, at its share of the frame', () => {
    const log: string[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          far: probe({
            move: (c) => {
              log.push(`far ${pursue(c, vec2(0, 10), 4)} ${at(c)} ${c.advancedAt}`);
            }
          }),
          near: probe({
            move: (c) => {
              log.push(`near ${pursue(c, vec2(3, 0), 4)} ${at(c)} ${c.advancedAt} ${c.heading.toFixed(4)}`);
            }
          })
        }
      }
    );

    game.areaTriggers.spawn(game.areaId.far, { owner: game.unit(1), at: vec2(0, 0) });
    game.areaTriggers.spawn(game.areaId.near, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1);
    assert.deepEqual(log, ['far 0 0.00,4.00 1', `near 1 3.00,0.00 0.75 ${(Math.PI / 2).toFixed(4)}`]);
  });

  it('turns by at most its turn rate, flying on along its heading', () => {
    const log: string[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          cyclone: probe({
            move: (c) => {
              log.push(`${pursue(c, vec2(10, 0), 1, 0.5)} ${c.heading} ${at(c)}`);
            }
          })
        }
      }
    );

    game.areaTriggers.spawn(game.areaId.cyclone, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 2);
    assert.deepEqual(log, [
      `0 0.5 ${Math.sin(0.5).toFixed(2)},${Math.cos(0.5).toFixed(2)}`,
      `0 1 ${(Math.sin(0.5) + Math.sin(1)).toFixed(2)},${(Math.cos(0.5) + Math.cos(1)).toFixed(2)}`
    ]);
  });

  it('sweeps its contact along the way, and does not move for no step', () => {
    const log: string[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          shot: probe({
            contact: { radius: 0.2 },

            move: (c) => {
              pursue(c, vec2(4, 0), 0);
              pursue(c, vec2(4, 0), 2);
            },

            onContact: (c, hit) => {
              log.push(`contact ${hit.targets.map((unit) => unit.id).join(',')} at ${at(c)}`);

              return undefined;
            }
          })
        }
      }
    );

    game.place(game.unit(100), vec2(1.5, 0));
    game.world.tick();
    game.areaTriggers.spawn(game.areaId.shot, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1);
    assert.deepEqual(log, ['contact 100 at 2.00,0.00']);
  });
});

describe('pursueUnit', () => {
  it('comes back to its owner, caught once within reach', () => {
    const log: string[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          chakram: probe({
            move: (c) => {
              if (pursueUnit(c, c.owner, 2, { reach: 0.8 })) {
                log.push(`caught ${at(c)}`);
                c.despawn();
              } else {
                log.push(`flying ${at(c)}`);
              }
            }
          })
        }
      }
    );

    const owner = game.unit(1);

    game.place(owner, vec2(0, 0));
    game.areaTriggers.spawn(game.areaId.chakram, { owner, at: vec2(5, 0) });
    ticks(game, 4);
    assert.deepEqual(log, ['flying 3.00,0.00', 'flying 1.00,0.00', 'caught 0.00,0.00']);
  });

  it('chains a glaive from mark to mark, each once, flying on with the travel left', () => {
    const marks: number[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          glaive: glaive({
            shape: circle(0.5),
            lifetime: 5,
            ledgers: { chain: { policy: 'once' } },
            state: (): { mark: Game['bearer'] | undefined } => ({ mark: undefined }),
            contact: { radius: 0.3, ledger: 'chain' },

            init: (c) => {
              c.state.mark = retarget(c, c.position, { range: 6, ledger: 'chain' });
            },

            move: (c, dt) => {
              let left = 16 * dt;

              while (left > 0 && c.state.mark !== undefined) {
                const before = c.state.mark;
                const travel = left;

                left = pursue(c, before.at, travel);

                if (c.state.mark === before) {
                  break;
                }
              }

              if (c.state.mark === undefined) {
                c.despawn();
              }
            },

            onContact: (c, hit) => {
              for (const unit of hit.targets) {
                marks.push(unit.id);
              }

              c.state.mark = retarget(c, c.position, { range: 6, ledger: 'chain' });

              return undefined;
            }
          })
        }
      }
    );

    game.place(game.unit(100), vec2(2, 0));
    game.place(game.unit(101), vec2(2, 3));
    game.place(game.unit(102), vec2(-1, 3));
    game.place(game.unit(103), vec2(40, 0));
    game.world.tick();
    game.areaTriggers.spawn(game.areaId.glaive, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 4);
    assert.deepEqual(marks, [100, 101, 102]);
  });
});

describe('fanHeading', () => {
  it('spreads shots evenly across the spread around a heading, one alone straight on', () => {
    assert.deepEqual(
      [0, 1, 2].map((i) => fanHeading(i, 3, 1, 0.25)),
      [-0.25, 0.25, 0.75]
    );
    assert.equal(fanHeading(0, 1, 1, 0.25), 0.25);
    assert.deepEqual(
      [0, 1, 2].map((i) => fanHeading(i, 3, (2 * Math.PI * 2) / 3).toFixed(6)),
      [(-2 * Math.PI) / 3, 0, (2 * Math.PI) / 3].map((heading) => heading.toFixed(6))
    );
  });
});
