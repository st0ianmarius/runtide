import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProcFrame } from '../../src/procs/frame.ts';
import {
  andThen,
  applyAura,
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  defineProcKind,
  group,
  pickOne,
  procOutcome,
  type ProcOutcome,
  type ProcStatus,
  removeAura,
  run
} from '../../src/procs/index.ts';
import { aura, type Game, makeGame, scripted, STRIKE, type StrikeProc } from '../helpers/trigger-game.ts';

const defs = {
  ward: aura({ duration: 4, tags: ['magic'] }),
  hex: aura({ duration: 4, tags: ['curse'], blockedBy: ['magic'] })
};

describe('a control kind inside which nothing happened', () => {
  it('is skipped: a group whose procs all skipped counts as not gone off', () => {
    const { procs, unit } = makeGame(defs);
    const u = unit(1);

    assert.equal(procs.run([group<Game>([removeAura('ward')])], { self: u }), 0);
    assert.equal(procs.run([group<Game>([])], { self: u }), 0);
    assert.equal(procs.run([group<Game>([removeAura('ward'), applyAura('ward')])], { self: u }), 1);
  });

  it('reports skipped to ctx.apply for group, andThen and pickOne, and landed when one of its procs went off', () => {
    const { procs, unit } = makeGame(defs, { procs: { random: scripted() } });
    const u = unit(1);
    const seen: ProcStatus[] = [];

    procs.run(
      [
        andThen<Game>((ctx) => {
          seen.push(
            ctx.apply(group([removeAura('ward')])).status,
            ctx.apply(andThen(() => undefined)).status,
            ctx.apply(andThen(() => [removeAura('ward')])).status,
            ctx.apply(
              pickOne(
                () => [u],
                () => [removeAura('ward')]
              )
            ).status,
            ctx.apply(run('noop', () => undefined)).status,
            ctx.apply(group([applyAura('ward')])).status,
            ctx.apply(
              pickOne(
                () => [u],
                () => [removeAura('ward')]
              )
            ).status
          );

          return undefined;
        })
      ],
      { self: u }
    );
    assert.deepEqual(seen, ['skipped', 'skipped', 'skipped', 'skipped', 'landed', 'landed', 'landed']);
  });
});

describe('a party proc’s outcome', () => {
  it('is the first member’s that landed, even when a later member refused it', () => {
    const { procs, unit } = makeGame(defs);
    const [a, b, c] = [unit(1), unit(2), unit(3)];

    procs.run([applyAura('ward', { to: a }), applyAura('ward', { to: c })], { self: a });
    assert.equal(procs.apply(applyAura('hex', { to: 'party' }), { self: a }).status, 'landed');
    assert.equal(procs.apply(applyAura('hex', { to: 'party' }), { self: b }).status, 'landed');
  });

  it('is the last one not skipped when none landed, and skipped when every member skipped', () => {
    const { procs, unit } = makeGame(defs);
    const [a, b] = [unit(1), unit(2)];

    procs.run([applyAura('ward', { to: a }), applyAura('ward', { to: b })], { self: a });
    assert.equal(procs.apply(applyAura('hex', { to: 'party' }), { self: a }).status, 'refused');
    procs.run([removeAura('ward', { to: 'party' })], { self: a });
    assert.equal(procs.apply(removeAura('ward', { to: 'party' }), { self: a }).status, 'skipped');
  });

  it('carries the landed member’s amount and kill, copied when a later member rewrote a pooled record', () => {
    const pooled: { status: ProcStatus; amount: number; hasKilled: boolean } = {
      status: 'landed',
      amount: 0,
      hasKilled: false
    };

    // A strike reporting into one reused record, as the damage engine's blow does: the target's id, a kill on unit 1.
    const pooledStrike = defineProcKind<StrikeProc, Game>({
      targetOf: (proc) => proc.to,

      apply: (_proc, _ctx, target): ProcOutcome => {
        pooled.amount = target?.id ?? 0;
        pooled.hasKilled = target?.id === 1;

        return pooled;
      }
    });

    const game = makeGame(defs);
    const [a] = [game.unit(1), game.unit(2), game.unit(3)];

    const procs = createProcSystem<Game>({
      kinds: createProcRegistry<Game>({ ...CORE_PROCS, strike: pooledStrike }),
      auras: game.auras,
      host: game.procs.host
    });

    const outcome = procs.apply({ kind: 'strike', amount: 0, to: 'party' }, { self: a });

    assert.deepEqual(procOutcome(outcome.status, outcome), procOutcome('landed', { amount: 1, hasKilled: true }));
    assert.equal(pooled.amount, 3);
  });

  it('pops the party stack when a member’s apply throws', () => {
    const game = makeGame(defs);
    const [a, b] = [game.unit(1), game.unit(2)];

    const throwing = defineProcKind<StrikeProc, Game>({
      targetOf: (proc) => proc.to,

      apply: (proc, ctx, target) => {
        if (target === b) {
          throw new Error('boom');
        }

        return STRIKE.apply(proc, ctx, target);
      }
    });

    const procs = createProcSystem<Game>({
      kinds: createProcRegistry<Game>({ ...CORE_PROCS, strike: throwing }),
      auras: game.auras,
      host: game.procs.host
    });

    const tops: number[] = [];

    procs.run(
      [
        andThen<Game>((ctx) => {
          assert.throws(() => ctx.apply({ kind: 'strike', amount: 1, to: 'party' }), /boom/);
          tops.push(ctx instanceof ProcFrame ? ctx.partyTop : -1);

          return undefined;
        })
      ],
      { self: a }
    );
    assert.deepEqual(tops, [0]);
  });
});
