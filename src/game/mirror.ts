import { createAbilitySystem } from '../abilities/index.ts';
import { type AuraClock, createAuraSystem } from '../auras/index.ts';
import type { ConditionTables } from '../conditions/index.ts';
import { createClock } from '../core/index.ts';
import { recordOf } from '../core/records.ts';
import { createCueBuffer, createCueEchoes } from '../cues/index.ts';
import { createModifierSystem } from '../modifiers/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import { createSpellSystem } from '../spells/index.ts';
import { extOr } from './late.ts';
import { checkMirror, tickedClocks } from './mirror-check.ts';
import { PredictionMirror } from './mirror-loop.ts';
import type { Mirror, MirrorBearerParts, MirrorOptions } from './mirror-types.ts';
import type { GameRecords, GameSpec, GameTypes } from './spec.ts';
import { wireOf } from './wire.ts';

/** Throws a `RangeError` naming what a mirror needs of its spec. */
const refuse = (problem: string): never => {
  throw new RangeError(`createMirror: ${problem}.`);
};

/** The proc system a mirror's spells are handed: none, so a payload reached on a mirror throws instead of running. */
const noProcs = <G extends GameTypes>(): ProcSystem<G> =>
  refuse('a prediction mirror runs no procs (a cast, a release or a hook payload reached it)');

/** Whether a name is one of a record's own keys. */
const isKeyOf = <Key extends string>(record: Readonly<Record<Key, unknown>>, name: string): name is Key =>
  Object.hasOwn(record, name);

/**
 * The mirror's own aura clocks: each of the spec's, in its declared order, with its step and no tick of the server's,
 * so a mirror built from the very spec a server was built from shares no clock with it.
 */
const ownClocks = <Clock extends string>(
  clocks: Readonly<Record<Clock, AuraClock>>
): Readonly<Record<Clock, AuraClock>> =>
  recordOf(
    Object.keys(clocks).filter((name) => isKeyOf(clocks, name)),
    (name) => Object.freeze({ dt: clocks[name].dt })
  );

/** The condition and value tables a mirror checks its predicted auras' modifier conditions against, if any. */
const conditionsOf = <G extends GameTypes>(spec: GameSpec<G>): ConditionTables | undefined => {
  const modifiers = spec.modifiers;

  return modifiers?.conditions === undefined && modifiers?.values === undefined
    ? undefined
    : { conditions: modifiers.conditions, values: modifiers.values };
};

/**
 * Builds the prediction mirror a client runs for its own unit, from the very `GameSpec` the server's `createGame` takes
 * (one spec builds both) and the mirror's options. It builds only what a predicting client runs: its own clocks (each
 * of the spec's, unshared), the modifier system when the spec has one, the aura system with its bearers silent, the
 * spell system with its own cue buffer and no proc system, the ability system as a mirror (`mirror: true`), and the
 * echo ring. No units, damage, procs, scripts, AI, world or area triggers: a mirror's press commits its button and
 * fires its spell's cast cue, and casts nothing, so no payload runs (one reached throws).
 *
 * At build it runs `checkPredicted` over its systems, `options.reads` and the clocks it ticks (`options.ticks`), and
 * throws one `RangeError` listing every aura it reads that is not predicted, every predicted aura that is unsafe,
 * unseedable or inexact, and every aura it reads on a clock it does not tick (frozen), unless `options.accept` names
 * it for that check. Its wire tables (`wire`) are what the handshake compares with the server's (`compareWire`).
 *
 * The client contract:
 * - The server sends, after each tick, one snapshot per predicting client (`createSnapshotWriter`): the key of the last
 *   input it consumed from that client (`ack`), the client's bearer's owner views and header (`auras.view`,
 *   `auras.headerOf`), and the tick's cues that reach the client (`encodeCues`, routed by `cueReaches`), before it
 *   clears its cue buffer. Its clocks, registries and cue registry match the client's (`compareWire` is empty).
 * - The client steps once per input it sends (`step`), keyed 1, 2, 3, … without wrapping, a mask of 0 for an input
 *   that presses nothing: the step ticks the mirror's clocks, then presses, as the server's tick does for the unit
 *   (`auras.tickAll`, then the unit's motion, where it presses), and the client plays the predicted cues (`cues`) and
 *   clears them.
 * - The client hands every snapshot to `receive` as it arrives, and plays what it heard (`heard`): the server's echo of
 *   a cue it predicted is dropped, a predicted cue never echoed by `ack` goes to `unconfirmed` (`CueEchoes.settle`,
 *   after the snapshot's cues are read), and a prediction that differs from the snapshot is reseeded and replayed.
 * - Motion reconciles in `onReseed`: a game whose `activate` hooks move a body keys that motion state by bearer object
 *   (both twins carry the unit's id), gives the acked twin (`MirrorBearerParts.role`) a hidden state of its own or none,
 *   and resets the predicted body to the server's at the ack in `onReseed`, before the replay moves it on. Without it a
 *   reseed replays motion from the body's current position.
 * - The mirror never runs a cast, a release, a proc, a hook payload, an aura hook or event, an AI or a script, and
 *   lands only predicted auras; what it predicts is the bearer's predicted auras (a press's cooldowns, cost, toggles,
 *   predicted `applies`) and its cast cues.
 * - The motion contract (`prediction`): the mirror and the server each step the unit's motion once per input they
 *   consume, the server never across a gap with no input until its stall threshold; so they run the same steps on the
 *   same reads, and a replay from an acknowledged input lands where the server did. A clock the mirror ticks once per
 *   input that the server ticks once per world tick (`world`) agrees with it only while the server consumes one input
 *   per tick; a stall is corrected by the next snapshot.
 *
 * Throws a `RangeError` for a spec without abilities, a clock named twice in `ticks`, an unknown clock, or an accepted
 * name that is not an aura.
 */
export const createMirror = <G extends GameTypes & GameRecords<G>>(
  spec: GameSpec<G>,
  options: MirrorOptions<G>
): Mirror<G> => {
  const abilitiesSpec = spec.abilities ?? refuse('a mirror predicts presses, so the spec needs abilities');
  const modifiers = spec.modifiers === undefined ? undefined : createModifierSystem(spec.modifiers);
  const clock = createClock({ dt: spec.clock.dt });
  const { statsOf } = options;

  const auras = createAuraSystem<G>({
    ...spec.auras,
    clocks: ownClocks(spec.auras.clocks),
    host: { ...spec.auras.host },
    createExt: extOr(spec.auras.createExt),
    ...(modifiers === undefined ? {} : { modifiers })
  });

  const registry = spec.spells.cues?.registry;
  const cues = registry === undefined ? undefined : createCueBuffer(registry);

  const spells = createSpellSystem<G>({
    ...spec.spells,
    auras,
    procs: noProcs,
    clock,
    host: { idOf: (unit) => unit.id, ...spec.spells.host, ...(statsOf === undefined ? {} : { statsOf }) },
    createExt: extOr(spec.spells.createExt),
    ...(cues === undefined ? {} : { cues })
  });

  const abilities = createAbilitySystem<G>({ ...abilitiesSpec, statsOf, spells, auras, clock, mirror: true });
  const ticks = tickedClocks(auras, options.ticks);
  const report = checkMirror({ auras, abilities }, options, conditionsOf(spec));
  const loadout = abilities.createLoadout();

  const make = (role: MirrorBearerParts['role']): G['bearer'] =>
    options.bearer({
      role,
      auras: auras.createState({ isSilent: true }),
      casts: spells.createCasterState(),
      loadout,
      sheet: modifiers?.createSheet()
    });

  return new PredictionMirror<G>({
    bearer: make('predicted'),
    acked: make('acked'),
    modifiers,
    auras,
    spells,
    abilities,
    cues,
    heard: registry === undefined ? undefined : createCueBuffer(registry),
    echoes: registry === undefined ? undefined : createCueEchoes(registry),
    report,
    wire: wireOf({ auras, spells, abilities, cues: registry }),
    ticks,
    onReseed: options.onReseed
  });
};
