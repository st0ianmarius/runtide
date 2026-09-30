import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AnyAreaTriggerDef,
  type AreaLedgerSpec,
  type AreaTriggerHandle,
  defineAreaTriggers,
  NO_AREA_TRIGGER,
  spawn
} from '../../src/area-triggers/index.ts';
import { circle, vec2 } from '../../src/math/index.ts';
import { AREA_TAGS, type Game, makeSpellGame, spell } from '../helpers/spell-game.ts';

/** Steps a game's clock and its area triggers `count` times. */
const ticks = (game: ReturnType<typeof makeSpellGame>, count: number): void => {
  for (let i = 0; i < count; i++) {
    game.step();
    game.areaTriggers.step();
  }
};

/** A pool pulsing every step, recording in a ledger, logging each beat as `hit <id> <age>: <unit>x<share>`. */
const pool = (ledger: AreaLedgerSpec, def: Partial<AnyAreaTriggerDef<Game>> = {}): AnyAreaTriggerDef<Game> => ({
  shape: circle(2),
  lifetime: 10,
  ledgers: { hits: ledger },
  every: [
    {
      seconds: 0.25,
      ledger: 'hits',

      onPulse: (c, hit) => {
        const units = hit.targets.map((unit, i) => `${unit.id}x${hit.shares[i]}`).join(',');

        if (units !== '') {
          c.host.log.push(`hit ${c.id} ${c.age}: ${units}`);
        }

        return undefined;
      }
    }
  ],
  ...def
});

/** A game's lines that start with `hit`. */
const hits = (log: readonly string[]): string[] => log.filter((line) => line.startsWith('hit '));

describe('hit policies', () => {
  it('lets each unit through once', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: pool({ policy: 'once' }) } });

    game.place(game.unit(100), vec2(0, 0));
    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 3);
    assert.deepEqual(hits(game.log), ['hit 1 0.25: 100x1']);
  });

  it('shares once-per-cast across every area trigger of the cast, and not across casts', () => {
    const game = makeSpellGame(
      {
        twin: spell({
          activation: { kind: 'trigger' },

          release: () => [spawn<Game>('pool', { at: vec2(0, 0) }), spawn<Game>('pool', { at: vec2(1, 0) })]
        })
      },
      { areaTriggers: { pool: pool({ policy: 'once', scope: 'cast' }) } }
    );

    const owner = game.unit(1);

    game.place(game.unit(100), vec2(0, 0));
    game.spells.cast(owner, game.id.twin);
    ticks(game, 2);
    game.spells.cast(owner, game.id.twin);
    ticks(game, 2);
    assert.deepEqual(hits(game.log), ['hit 1 0.25: 100x1', 'hit 3 0.25: 100x1']);
  });

  it('lets a repeat through at its share', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: pool({ policy: 'repeat', share: 0.25 }) } });

    game.place(game.unit(100), vec2(0, 0));
    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 3);
    assert.deepEqual(hits(game.log), ['hit 1 0.25: 100x1', 'hit 1 0.5: 100x0.25', 'hit 1 0.75: 100x0.25']);
  });

  it('lets a unit through again once its cooldown ran', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: pool({ policy: 'rehit', cooldown: 0.75 }) } });

    game.place(game.unit(100), vec2(0, 0));
    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 7);
    assert.deepEqual(hits(game.log), ['hit 1 0.25: 100x1', 'hit 1 1: 100x1', 'hit 1 1.75: 100x1']);
  });

  it('keeps its rehits right while it forgets the units whose cooldown ran, over a crowd', () => {
    const counts: number[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          pool: pool(
            { policy: 'rehit', cooldown: 0.5 },
            {
              shape: circle(20),
              every: [
                {
                  seconds: 0.25,
                  ledger: 'hits',

                  onPulse: (_c, hit) => {
                    counts.push(hit.targets.length);

                    return undefined;
                  }
                }
              ]
            }
          )
        }
      }
    );

    for (let i = 0; i < 70; i++) {
      game.place(game.unit(100 + i), vec2((i % 10) - 5, Math.floor(i / 10) - 3));
    }

    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 6);
    assert.deepEqual(counts, [70, 0, 70, 0, 70, 0]);
  });

  it('is spent after its budget of hits, ending the area trigger as spent', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: pool({ policy: 'repeat', budget: 3 }) } });

    game.place(game.unit(100), vec2(0, 0));
    game.place(game.unit(101), vec2(1, 0));
    game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 3);
    assert.deepEqual(hits(game.log), ['hit 1 0.25: 100x1,101x1', 'hit 1 0.5: 100x1']);
    assert.ok(game.log.includes('ended pool@1 spent'));
  });
});

describe('pierce', () => {
  it('lets a missile through as many different units as it pierces, in the order it reached them', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          missile: {
            shape: circle(0.5),
            lifetime: 3,
            ledgers: { pierced: { policy: 'once', pierce: 2 } },
            contact: { radius: 0.5, ledger: 'pierced' },

            move: (c, dt) => {
              c.position.x += 20 * dt;
            },

            onContact: (c, hit) => {
              c.host.log.push(`hit ${hit.targets.map((unit) => unit.id).join(',')}`);

              return undefined;
            }
          }
        }
      }
    );

    game.place(game.unit(100), vec2(3, 0));
    game.place(game.unit(101), vec2(2, 0));
    game.place(game.unit(102), vec2(4, 0));
    game.areaTriggers.spawn(game.areaId.missile, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1);
    assert.deepEqual(hits(game.log), ['hit 101,100']);
    assert.ok(game.log.includes('ended missile@1 spent'));
  });
});

describe('a ledger read by hooks', () => {
  it('records and reports as its policy says, shared by a cast', () => {
    const seen: string[] = [];

    const game = makeSpellGame(
      { zap: spell({ activation: { kind: 'trigger' }, release: () => [spawn<Game>('spark')] }) },
      {
        areaTriggers: {
          spark: {
            shape: circle(1),
            lifetime: 5,
            ledgers: { links: { policy: 'once', scope: 'cast' } },

            init: (c) => {
              const links = c.ledger('links');
              const unit = c.owner;

              if (c.parent === NO_AREA_TRIGGER) {
                seen.push(`first ${links.record(unit)} ${links.record(unit)} ${links.has(unit)} ${links.distinct}`);
              } else {
                seen.push(`child ${links.shareOf(unit)} ${links.hits}`);
              }
            },

            frame: (c) => (c.age === 0.25 ? [spawn<Game>('spark')] : undefined)
          }
        }
      }
    );

    const owner = game.unit(1);
    const cast: AreaTriggerHandle[] = [];

    game.spells.cast(owner, game.id.zap);
    game.areaTriggers.query({ owner }, cast);

    const handle = cast[0] ?? NO_AREA_TRIGGER;

    assert.throws(() => game.areaTriggers.get(handle)?.ledger('nothing'), /has no ledger nothing/);
    ticks(game, 1);
    assert.deepEqual(seen, ['first 1 0 true 1', 'child 0 1']);
  });

  it('goes back to the pool with the last area trigger that shares it', () => {
    const game = makeSpellGame({}, { areaTriggers: { pool: pool({ policy: 'once' }, { lifetime: 0.25 }) } });

    const handles: AreaTriggerHandle[] = [];

    for (let i = 0; i < 3; i++) {
      handles.push(game.areaTriggers.spawn(game.areaId.pool, { owner: game.unit(1), at: vec2(0, 0) }));
    }

    assert.equal(game.areaTriggers.pool.ledgers, 3);
    ticks(game, 1);
    assert.deepEqual(
      handles.map((handle) => game.areaTriggers.isLive(handle)),
      [false, false, false]
    );
    assert.equal(game.areaTriggers.pool.ledgers, 0);
  });
});

describe('ledger checks at load', () => {
  const refuse = (def: AnyAreaTriggerDef<Game>, message: RegExp): void => {
    assert.throws(() => defineAreaTriggers<Game, 'bad'>({ bad: def }, { tags: AREA_TAGS }), message);
  };

  it('refuse a catch that names an undeclared ledger, and a bad spec', () => {
    refuse({ shape: circle(1), lifetime: 1, contact: { radius: 1, ledger: 'hits' } }, /records in ledger hits/);
    refuse({ shape: circle(1), lifetime: 1, ledgers: { hits: { policy: 'repeat', share: 2 } } }, /a share from 0 to 1/);
    refuse({ shape: circle(1), lifetime: 1, ledgers: { hits: { policy: 'rehit' } } }, /rehits after a cooldown/);
    refuse({ shape: circle(1), lifetime: 1, ledgers: { hits: { policy: 'once', pierce: 0 } } }, /pierces and budgets/);
  });
});
