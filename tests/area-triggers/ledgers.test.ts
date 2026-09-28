import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AnyAreaTriggerDef,
  type AreaLedgerSpec,
  type AreaTriggerHandle,
  defineAreaTriggers,
  NO_AREA_TRIGGER,
  spawn,
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
      },
    },
  ],
  ...def,
});

/** A game's lines that start with `hit`. */
const hits = (log: readonly string[]): string[] => log.filter((line) => line.startsWith('hit '));

describe('hit policies (§II.3.4, §II.6 W3)', () => {
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
          release: () => [spawn<Game>('pool', { at: vec2(0, 0) }), spawn<Game>('pool', { at: vec2(1, 0) })],
        }),
      },
      { areaTriggers: { pool: pool({ policy: 'once', scope: 'cast' }) } },
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

describe('pierce and claims (§II.6 W3)', () => {
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
            },
          },
        },
      },
    );

    game.place(game.unit(100), vec2(3, 0));
    game.place(game.unit(101), vec2(2, 0));
    game.place(game.unit(102), vec2(4, 0));
    game.areaTriggers.spawn(game.areaId.missile, { owner: game.unit(1), at: vec2(0, 0) });
    ticks(game, 1);
    assert.deepEqual(hits(game.log), ['hit 101,100']);
    assert.ok(game.log.includes('ended missile@1 spent'));
  });

  it('keeps a claimed unit for its claimant within a family, until the claimant ends', () => {
    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          glaive: pool(
            { policy: 'claim', scope: 'family' },
            { frame: (c) => (c.age === 0.25 ? [spawn<Game>('glaive')] : undefined) },
          ),
        },
      },
    );

    game.place(game.unit(100), vec2(0, 0));

    const parent = game.areaTriggers.spawn(game.areaId.glaive, { owner: game.unit(1), at: vec2(0, 0) });

    ticks(game, 2);
    game.areaTriggers.despawn(parent);
    ticks(game, 1);
    assert.deepEqual(hits(game.log), ['hit 1 0.25: 100x1', 'hit 1 0.5: 100x1', 'hit 2 0.5: 100x1']);
  });
});

describe('a ledger read by hooks (§II.6 W3)', () => {
  it('records, reserves and reports as its policy says, shared by a family', () => {
    const seen: string[] = [];

    const game = makeSpellGame(
      {},
      {
        areaTriggers: {
          spark: {
            shape: circle(1),
            lifetime: 5,
            ledgers: { links: { policy: 'once', scope: 'family' }, own: { policy: 'claim' } },

            init: (c) => {
              const links = c.ledger('links');
              const unit = c.owner;

              if (c.parent === NO_AREA_TRIGGER) {
                seen.push(`first ${links.record(unit)} ${links.record(unit)} ${links.has(unit)} ${links.distinct}`);
              } else {
                seen.push(`child ${links.shareOf(unit)} ${links.hits}`);
              }
            },

            frame: (c) => (c.age === 0.25 ? [spawn<Game>('spark')] : undefined),
          },
        },
      },
    );

    const owner = game.unit(1);
    const handle = game.areaTriggers.spawn(game.areaId.spark, { owner, at: vec2(0, 0) });
    const own = game.areaTriggers.get(handle)?.ledger('own');

    assert.equal(own?.reserve(owner), true);
    assert.equal(own?.isClaimed(owner), false);
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
      [false, false, false],
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
