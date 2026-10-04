import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DIGEST_START } from '../../src/core/index.ts';
import { after } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell, TICK_SLOTS, type Unit } from '../helpers/spell-game.ts';

/** The test spells: a windup aimed at a unit, one aimed at a point, a beating channel, and an auto swing. */
const SPELLS = {
  bolt: spell({
    activation: { kind: 'trigger' },
    timeline: { windup: { seconds: 1 }, recover: { seconds: 0.5 }, interrupts: { stun: 'pause' } },
    target: (_ctx, input) => input,
    release: () => [mark('bolt')]
  }),

  blast: spell({
    activation: { kind: 'trigger' },
    timeline: { windup: { seconds: 0.75 } },
    target: () => ({ x: 3, z: 4 }),
    release: () => undefined
  }),

  drain: spell({
    activation: { kind: 'trigger' },
    timeline: { channel: { seconds: 2, every: 0.5, tick: () => [mark('drain')] } },
    release: () => undefined
  }),

  swing: spell({ activation: { kind: 'auto', interval: 0.75 }, release: () => [mark('swing')] })
};

/** A game over the test spells, two units and the stun interrupt, over both tick slots. */
const digestGame = () => {
  const game = makeSpellGame(SPELLS, { spells: { slots: TICK_SLOTS } });
  const hero = game.unit(1);
  const foe = game.unit(100);

  return { game, hero, foe };
};

type DigestGame = ReturnType<typeof digestGame>;

/** One full tick: the clock, the auto clocks and casts of each unit, then each slot's delayed lists. */
const tick = ({ game, hero, foe }: DigestGame): void => {
  game.step();

  for (const unit of [hero, foe]) {
    game.spells.stepAuto(unit);
    game.spells.step(unit);
  }

  game.spells.stepDelayed(TICK_SLOTS.id.world);
  game.spells.stepDelayed(TICK_SLOTS.id.late);
};

/** The digest of both units' spell state and the delayed lists. */
const digestOf = ({ game, hero, foe }: DigestGame): number =>
  game.spells.digestDelayed(game.spells.digest(foe, game.spells.digest(hero, DIGEST_START)));

/** Drives a game through casts, an interrupt and delayed lists, recording its digest after every tick. */
const drive = (state: DigestGame, script: (state: DigestGame, at: number) => void): number[] => {
  const digests: number[] = [];

  for (let at = 0; at < 16; at++) {
    script(state, at);
    tick(state);
    digests.push(digestOf(state));
  }

  return digests;
};

/** The shared script: a bolt at the foe, a blast, a stun and its end, a drain, and delayed lists in both slots. */
const SCRIPT = ({ game, hero, foe }: DigestGame, at: number): void => {
  if (at === 0) {
    game.spells.cast(hero, game.id.bolt, { input: foe, key: 4 });
    game.spells.cast(foe, game.id.blast);
    game.procs.apply(after<Game>(1, [mark('late')], { slot: TICK_SLOTS.id.late }), { self: hero });
  }

  if (at === 2) {
    game.spells.interrupt(hero, 'stun');
    game.procs.apply(after<Game>(0.5, [mark('soon')]), { self: foe, target: hero });
  }

  if (at === 4) {
    game.spells.endInterrupt(hero, 'stun');
    game.spells.cast(foe, game.id.drain);
  }
};

describe('spell digests', () => {
  it('fold alike, tick for tick, for two games driven alike', () => {
    const first = drive(digestGame(), SCRIPT);
    const second = drive(digestGame(), SCRIPT);

    assert.deepEqual(first, second);
    assert.ok(new Set(first).size > 8, 'the digest follows the state as it changes');
  });

  it('change no state: asked twice, they answer the same', () => {
    const state = digestGame();

    drive(state, (game, at) => {
      SCRIPT(game, at);

      if (at === 6) {
        assert.equal(digestOf(game), digestOf(game));
      }
    });
  });

  it('part for a cast’s target, key, rank or stage clock', () => {
    const variants: ((state: DigestGame) => void)[] = [
      ({ game, hero, foe }) => game.spells.cast(hero, game.id.bolt, { input: foe, key: 4 }),
      ({ game, hero }) => game.spells.cast(hero, game.id.bolt, { input: hero, key: 4 }),
      ({ game, hero, foe }) => game.spells.cast(hero, game.id.bolt, { input: foe, key: 5 }),
      ({ game, hero, foe }) => game.spells.cast(hero, game.id.bolt, { input: foe, key: 4, rank: 2 }),
      ({ game, hero, foe }) => game.spells.cast(hero, game.id.bolt, { input: foe, key: 4, stages: { windup: 2 } }),
      ({ game, hero }) => game.spells.cast(hero, game.id.blast)
    ];

    const digests = variants.map((variant) => {
      const state = digestGame();

      variant(state);

      return state.game.spells.digest(state.hero, DIGEST_START);
    });

    assert.equal(new Set(digests).size, variants.length);
  });

  it('part for a stage stepped, a pause, an auto clock armed or set, and an interrupt held', () => {
    const changes: ((state: DigestGame) => void)[] = [
      () => undefined,
      ({ game, hero }) => {
        game.spells.step(hero);
      },
      ({ game, hero }) => game.spells.pause(castOf(game, hero)),
      ({ game, hero }) => game.spells.interrupt(hero, 'stun'),
      ({ game, hero }) => game.spells.disarm(hero, game.id.swing),
      ({ game, hero }) => game.spells.setClock(hero, game.id.swing, 0.5),
      ({ game, hero }) => {
        game.spells.stepAuto(hero);
      }
    ];

    const digests = changes.map((change) => {
      const state = digestGame();

      state.game.spells.cast(state.hero, state.game.id.bolt, { input: state.foe });
      state.game.step();
      change(state);

      return state.game.spells.digest(state.hero, DIGEST_START);
    });

    assert.equal(new Set(digests).size, changes.length);
  });

  it('fold the delayed lists in due order, whatever order they were scheduled in', () => {
    const scheduled = (order: readonly number[]): number => {
      const { game, hero, foe } = digestGame();

      for (const seconds of order) {
        game.procs.apply(after<Game>(seconds, [mark(`at ${seconds}`)]), { self: hero, target: foe });
      }

      return game.spells.digestDelayed(DIGEST_START);
    };

    assert.equal(scheduled([2, 1, 0.5]), scheduled([0.5, 1, 2]));
    assert.equal(scheduled([2, 1, 0.5]), scheduled([1, 0.5, 2]));
    assert.notEqual(scheduled([2, 1, 0.5]), scheduled([2, 1, 0.75]));
    assert.notEqual(scheduled([2, 1]), scheduled([2, 1, 0.5]));
  });

  it('part for a delayed list’s slot, owner, origin and procs', () => {
    const lists: ((game: DigestGame) => void)[] = [
      ({ game, hero }) => game.procs.apply(after<Game>(1, [mark('a')]), { self: hero }),
      ({ game, hero }) => game.procs.apply(after<Game>(1, [mark('a')], { slot: TICK_SLOTS.id.late }), { self: hero }),
      ({ game, hero }) => game.procs.apply(after<Game>(1, [mark('a')], { owner: 'none' }), { self: hero }),
      ({ game, foe }) => game.procs.apply(after<Game>(1, [mark('a')]), { self: foe }),
      ({ game, hero, foe }) => game.procs.apply(after<Game>(1, [mark('a')]), { self: hero, target: foe }),
      ({ game, hero }) => game.procs.apply(after<Game>(1, [mark('a'), mark('b')]), { self: hero })
    ];

    const digests = lists.map((list) => {
      const state = digestGame();

      list(state);

      return state.game.spells.digestDelayed(DIGEST_START);
    });

    assert.equal(new Set(digests).size, lists.length);
  });

  it('drop a withdrawn or landed list', () => {
    const { game, hero } = digestGame();
    const empty = game.spells.digestDelayed(DIGEST_START);

    game.procs.apply(after<Game>(0.25, [mark('a')]), { self: hero });
    assert.notEqual(game.spells.digestDelayed(DIGEST_START), empty);
    game.spells.withdrawDelayed(hero);
    assert.equal(game.spells.digestDelayed(DIGEST_START), empty);
    game.procs.apply(after<Game>(0.25, [mark('a')]), { self: hero });
    game.step();
    game.spells.stepDelayed();
    assert.equal(game.spells.digestDelayed(DIGEST_START), empty);
  });
});

/** The hero's first running cast. */
const castOf = (game: DigestGame['game'], hero: Unit) => {
  const out = [game.spells.current];

  game.spells.castsOf(hero, out);

  return out[0] ?? game.spells.current;
};
