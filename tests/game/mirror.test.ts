import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraSystem } from '../../src/auras/index.ts';
import { compareWire, createGame, createMirror, type Mirror, wireOf } from '../../src/game/index.ts';
import type { Unit } from '../../src/units/index.ts';
import {
  AURAS,
  BODIES,
  CUES,
  DODGE,
  heroBearer,
  type Link,
  makeLink,
  type MirrorGame,
  mirrorSpecOf
} from './mirror-fixture.ts';

/** A bearer's predicted auras, each as `name seconds-left`. */
const predictedOf = (auras: AuraSystem<MirrorGame>, bearer: Unit<MirrorGame>): string[] =>
  auras
    .list(bearer)
    .filter((aura) => auras.isPredicted(aura.id))
    .map((aura) => `${AURAS.name(aura.id)} ${auras.remainingOf(bearer, aura)}`);

/** How many times the client played a cue, as `name#key`. */
const playsOf = (link: Link, cue: string): number => link.played.filter((played) => played === cue).length;

/** Checks the client and the server agree once every snapshot has arrived: nothing pending, the same predicted auras. */
const assertSettled = (link: Link, ack: number): void => {
  const { mirror, server, hero } = link;
  const last = link.last();

  assert.ok(last !== undefined);
  assert.deepEqual([mirror.ack, mirror.pending], [ack, 0]);
  assert.equal(mirror.auras.matchesSeed(mirror.bearer, last), true);
  assert.deepEqual(predictedOf(mirror.auras, mirror.bearer), predictedOf(server.auras, hero));
};

describe('a server and its prediction mirror, built from one spec', () => {
  it('plays a press predicted right once, drops the server’s echo, and never reseeds', () => {
    const link = makeLink();

    link.run([{}, { press: 'dodge' }, {}, { press: 'skill' }, {}]);

    assert.deepEqual(link.played, ['swish#2', 'zap#4', 'thud#0']);
    assert.deepEqual(link.unconfirmed, []);
    assert.equal(link.mirror.reseeds, 0);
    assertSettled(link, 5);
    assert.deepEqual(predictedOf(link.server.auras, link.hero), ['dodgeCooldown 0.25', 'boltCooldown 1.75']);
  });

  it('hands a press the server refused to unconfirmed, reseeds, and lands where the server did after the replay', () => {
    const link = makeLink();

    link.run([
      {},
      { after: (server, hero) => void server.auras.apply(hero, AURAS.id.stun) },
      { press: 'skill' },
      {},
      {},
      {},
      { press: 'skill' },
      {},
      {}
    ]);

    assert.deepEqual(link.unconfirmed, ['zap#3']);
    assert.equal(playsOf(link, 'zap#3'), 1);
    assert.equal(link.mirror.reseeds, 1);
    assert.deepEqual(link.played, ['zap#3', 'zap#7', 'thud#0']);
    assertSettled(link, 9);
    assert.deepEqual(predictedOf(link.server.auras, link.hero), ['boltCooldown 1.5']);
  });

  it('settles later presses past a dropped input, and a replay plays nothing twice', () => {
    const link = makeLink({ latency: 3 });

    link.run([{}, { press: 'dodge' }, {}, { press: 'skill', dropped: true }, {}, {}, { press: 'dodge' }, {}, {}]);

    assert.deepEqual(link.played, ['swish#2', 'zap#4', 'swish#7']);
    assert.deepEqual(link.unconfirmed, ['zap#4']);
    assert.ok(link.mirror.reseeds >= 1);
    assertSettled(link, 9);
    assert.deepEqual(predictedOf(link.server.auras, link.hero), ['dodgeCooldown 0.5']);
  });

  it('expires a world-clock cooldown on the same step on both sides when the mirror ticks the world clock', () => {
    const link = makeLink();
    const cooling: string[] = [];

    link.onRound = (key) => {
      const server = link.server.auras.has(link.hero, AURAS.id.boltCooldown);
      const mirror = link.mirror.auras.has(link.mirror.bearer, AURAS.id.boltCooldown);

      cooling.push(`${key}:${server ? 'S' : '-'}${mirror ? 'M' : '-'}`);
    };

    link.run([{ press: 'skill' }, ...Array.from({ length: 10 }, () => ({}))]);
    assert.deepEqual(cooling, [
      '1:SM',
      '2:SM',
      '3:SM',
      '4:SM',
      '5:SM',
      '6:SM',
      '7:SM',
      '8:SM',
      '9:--',
      '10:--',
      '11:--'
    ]);
    assert.equal(link.mirror.reseeds, 0);
  });
});

describe('motion a dodge’s activate hook predicts', () => {
  /** A body's place along x; NaN for a bearer without one. */
  const xOf = (bearer: Unit<MirrorGame>): number => BODIES.get(bearer)?.x ?? Number.NaN;

  /** A dodge, a stun the client cannot foresee, a refused bolt, then a dodge still unacknowledged at the reseed. */
  const script = [
    { press: 'dodge' },
    { after: (server, hero) => void server.auras.apply(hero, AURAS.id.stun) },
    { press: 'skill' },
    {},
    {},
    { press: 'dodge' },
    {},
    {}
  ] satisfies Parameters<Link['run']>[0];

  it('resets the body in onReseed, before the replay moves it on, and the acked twin never moves it', () => {
    const serverX = new Map<number, number>();
    const reseeds: string[] = [];
    const seen: string[] = [];

    const link = makeLink({
      latency: 4,

      onReseed: (bearer, snapshot) => {
        reseeds.push(`ack ${snapshot.ack} at x ${xOf(bearer)} pending ${link.mirror.pending}`);
        assert.equal(bearer, link.mirror.bearer);

        const body = BODIES.get(bearer);

        if (body !== undefined) {
          body.x = serverX.get(snapshot.ack) ?? Number.NaN;
        }
      }
    });

    link.onRound = (key) => {
      serverX.set(key, xOf(link.hero));
      seen.push(`${key}: ${xOf(link.mirror.bearer)}/${xOf(link.hero)}`);
    };

    link.run(script);
    assert.deepEqual(reseeds, ['ack 2 at x 4 pending 4']);
    assert.equal(link.mirror.reseeds, 1);
    assert.deepEqual(seen, ['1: 2/2', '2: 2/2', '3: 2/2', '4: 2/2', '5: 2/2', '6: 4/4', '7: 4/4', '8: 4/4']);
    assert.equal(xOf(link.mirror.bearer), (serverX.get(2) ?? 0) + DODGE);
    assert.equal(BODIES.has(link.mirror.acked), false);
  });

  it('replays motion from the body’s current place without onReseed, moving it again', () => {
    const link = makeLink({ latency: 4 });

    link.run(script);
    assert.equal(link.mirror.reseeds, 1);
    assert.deepEqual([xOf(link.mirror.bearer), xOf(link.hero)], [4 + DODGE, 4]);
  });
});

describe('createMirror', () => {
  const spec = mirrorSpecOf();
  const bearer = heroBearer(1);

  it('refuses a mirror that reads world-clock auras but ticks only the motion clock, unless it accepts them', () => {
    assert.throws(
      () => createMirror(spec, { bearer, ticks: ['motion'] }),
      /createMirror, ticking motion: frozen \(read by the mirror on a clock it does not tick\): stun, boltCooldown\./
    );

    const mirror = createMirror(spec, { bearer, ticks: ['motion'], accept: { frozen: ['stun', 'boltCooldown'] } });

    assert.deepEqual(mirror.report.frozen, [AURAS.id.stun, AURAS.id.boltCooldown]);
    assert.deepEqual(mirror.report.unread, [AURAS.id.dash]);
    assert.deepEqual(mirror.ticks, ['motion']);
  });

  it('ticks its clocks in declared order, whatever order they are named in, and refuses one named twice', () => {
    assert.deepEqual(createMirror(spec, { bearer, ticks: ['motion', 'world'] }).ticks, ['world', 'motion']);
    assert.throws(() => createMirror(spec, { bearer, ticks: ['world', 'world'] }), /each clock once/);
    assert.throws(
      () => createMirror(spec, { bearer, ticks: ['world', 'motion'], accept: { frozen: ['nothing'] } }),
      /accept names nothing, which is not an aura/
    );
  });

  it('refuses a spec without abilities', () => {
    const { abilities: _abilities, ...withoutAbilities } = spec;

    assert.throws(
      () => createMirror(withoutAbilities, { bearer, ticks: ['world', 'motion'] }),
      /a mirror predicts presses, so the spec needs abilities/
    );
  });

  it('has the server’s wire tables, and the handshake catches a client declaring its clocks in another order', () => {
    const server = createGame(mirrorSpecOf());
    const serverWire = wireOf({ ...server, cues: CUES });
    const same = createMirror(mirrorSpecOf(), { bearer, ticks: ['world', 'motion'] });
    const swapped = createMirror(mirrorSpecOf('motion-first'), { bearer, ticks: ['world', 'motion'] });

    assert.deepEqual(compareWire(serverWire, same.wire), []);
    assert.ok(compareWire(serverWire, swapped.wire).includes('auraClocks'));
  });
});

describe('the reconcile loop', () => {
  /** A mirror of hero 1 ticking both clocks. */
  const mirrorOf = (): Mirror<MirrorGame> =>
    createMirror(mirrorSpecOf(), { bearer: heroBearer(1), ticks: ['world', 'motion'] });

  it('steps increasing keys only, and takes no snapshot acknowledging a key it never stepped', () => {
    const mirror = mirrorOf();

    mirror.step(0, { key: 1 });
    assert.throws(() => mirror.step(0, { key: 1 }), /increasing whole keys/);
    assert.throws(
      () => mirror.receive({ ack: 2, views: [], count: 0, clocks: [0, 0], serials: 0, cues: new Uint8Array(0) }),
      /0 to 1/
    );
  });

  it('ignores a stale snapshot', () => {
    const mirror = mirrorOf();
    const snapshot = { ack: 1, views: [], count: 0, clocks: [1, 1], serials: 0, cues: new Uint8Array(0) };

    mirror.step(0, { key: 1 });
    mirror.step(0, { key: 2 });
    mirror.receive({ ...snapshot, ack: 2, clocks: [2, 2] });
    assert.equal(mirror.receive(snapshot), false);
    assert.deepEqual([mirror.ack, mirror.pending], [2, 0]);
  });
});
