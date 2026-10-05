import type { AbilitySystem, LoadoutState, Press } from '../abilities/index.ts';
import type { AuraState, AuraSystem } from '../auras/index.ts';
import type { CueBuffer, CueEchoes } from '../cues/index.ts';
import type { ModifierSystem, StatSheet, StatView } from '../modifiers/index.ts';
import type { MotionReads, PredictedReport } from '../prediction/index.ts';
import type { CasterState, SpellId, SpellSystem } from '../spells/index.ts';
import type { MirrorSnapshot } from './snapshot.ts';
import type { GameTypes } from './spec.ts';
import type { GameWire } from './wire.ts';

/** The states a mirror makes for each of its bearers, which the game's `bearer` factory puts on its bearer. */
export interface MirrorBearerParts {
  /**
   * Which twin is being built: the `predicted` bearer, the client's visible unit, or the `acked` one, which steps every
   * input again as the server acknowledges it. Both carry the server unit's entity id, so a game keys its motion state
   * by bearer object, not by id, and gives the acked twin its own hidden motion state (or none), so its steps never move
   * the visible body.
   */
  readonly role: 'predicted' | 'acked';

  /** A silent aura state (`auras.createState({ isSilent: true })`): it runs no hooks and raises nothing, and is seeded. */
  readonly auras: AuraState;

  /** A caster state, which never holds a cast: a mirror casts nothing. */
  readonly casts: CasterState;

  /** The loadout, one for both bearers: the game equips the predicted bearer and the acknowledged one shares it. */
  readonly loadout: LoadoutState;

  /** A stat sheet, when the spec has a modifier system; for the game's `statsOf` to fold. */
  readonly sheet: StatSheet | undefined;
}

/** The checks of `checkPredicted` that `createMirror` refuses a mirror on (all but `unread`, which only costs the wire). */
export type MirrorRefusal = keyof Omit<PredictedReport, 'unread'>;

/** A predicted cue the server never echoed, handed to `receive`'s `unconfirmed` as `CueEchoes.settle` hands it. */
export type Unconfirmed = (cue: number, owner: number, key: number) => void;

/** What a mirror is built with beyond the game's spec. */
export interface MirrorOptions<G extends GameTypes> {
  /**
   * Makes the local player's bearer, as the game's client holds it, over the states the mirror made: its entity id is
   * its unit's on the server, which its cues carry as their owner (the echo match). Called twice, for the predicted
   * bearer and the acknowledged one.
   */
  readonly bearer: (parts: MirrorBearerParts) => G['bearer'];

  /**
   * The aura clocks the mirror ticks, once each per consumed input, by name; it ticks them in the system's declared
   * order (`auras.clockTable`) whatever order they are named in. An aura the mirror reads on a clock it does not tick
   * is frozen between acks, and refused (`MirrorRefusal`) unless accepted.
   */
  readonly ticks: readonly G['clock'][];

  /** What the game's own motion step reads beyond the presses (`MotionReads`, its clocks being `ticks`); none when absent. */
  readonly reads?: Omit<MotionReads<G>, 'clocks'>;

  /** The bearer's stats for a spell as the mirror folds them (`MirrorCtx.stats`, cooldown lengths); none when absent. */
  readonly statsOf?: (bearer: G['bearer'], spell: SpellId) => StatView | undefined;

  /**
   * The auras, by name, whose findings the game accepts, per check: the mirror is built with them listed in its
   * `report` instead of refused. None when absent.
   */
  readonly accept?: Readonly<Partial<Record<MirrorRefusal, readonly string[]>>>;

  /**
   * Where motion reconciles: called on a reseed with the predicted bearer and the snapshot, after both bearers are seeded
   * and before the predicted one replays the unacknowledged inputs, so the game puts its predicted motion state
   * (position, velocity) back to the server's at `snapshot.ack`, from its own replicated data; the replay's `activate`
   * hooks then move it on from there. Without it, a reseed replays motion from wherever the body already is, moving it
   * again by every replayed input.
   */
  readonly onReseed?: (bearer: G['bearer'], snapshot: MirrorSnapshot) => void;
}

/** One consumed input's press on a mirror: a press (`Press`) whose key is required. */
export type MirrorPress<G extends GameTypes> = Press<G> & {
  /** The input's key: a whole number from 1, above every key the mirror stepped before. */
  readonly key: number;
};

/**
 * A prediction mirror: what a predicting client runs for its own unit, built by `createMirror` from the game's spec.
 * It holds two bearers: the predicted one (`bearer`, every input stepped) and the acknowledged one (`acked`, the inputs
 * the server has consumed), and the inputs between them. See `createMirror` for the whole client contract.
 */
export interface Mirror<G extends GameTypes> {
  /** The predicted bearer: the local player's unit as of the last stepped input. */
  readonly bearer: G['bearer'];

  /** The acknowledged bearer: the mirror's prediction as of the last acknowledged input, which a snapshot is compared with. */
  readonly acked: G['bearer'];

  /** The modifier system, when the spec has one. */
  readonly modifiers: ModifierSystem<G['bearer'], G['stat'], G['condition'], G['valueKind'], G['source']> | undefined;

  /** The aura system: the spec's registry, its bearers silent. */
  readonly auras: AuraSystem<G>;

  /** The spell system: it predicts cast cues and cooldowns, and runs no proc (a cast reaching one throws). */
  readonly spells: SpellSystem<G>;

  /** The ability system, a prediction mirror (`mirror: true`). */
  readonly abilities: AbilitySystem<G>;

  /**
   * The cues the steps predicted (the presses' cast cues), in firing order, each noted in `echoes`: the game plays
   * them and clears the buffer. A replay leaves it as it found it. `undefined` for a spec without cues.
   */
  readonly cues: CueBuffer | undefined;

  /**
   * The cues the last `receive` heard from the server, its echoes of predicted ones dropped: the game plays them
   * before the next `receive`, which clears them. `undefined` for a spec without cues.
   */
  readonly heard: CueBuffer | undefined;

  /** The predicted cues awaiting their echoes. `undefined` for a spec without cues. */
  readonly echoes: CueEchoes | undefined;

  /** What `checkPredicted` found at build: empty but for `unread` and what `accept` let through. */
  readonly report: PredictedReport;

  /** The mirror's wire tables, which the handshake compares with the server's (`compareWire`). */
  readonly wire: GameWire;

  /** The aura clocks it ticks per input, by name, in declared order. */
  readonly ticks: readonly G['clock'][];

  /** The key of the last input the server acknowledged; 0 before the first. */
  readonly ack: number;

  /** The key of the last input stepped; 0 before the first. */
  readonly lastKey: number;

  /** How many stepped inputs await their acknowledgement. */
  readonly pending: number;

  /** How many `receive`s found the prediction wrong, reseeded and replayed. */
  readonly reseeds: number;

  /**
   * One motion step for one consumed input, on the predicted bearer: ticks its `ticks` clocks once each in declared
   * order, then presses (`abilities.tryActivate(bearer, pressed, press)`, a mask of 0 for an input that presses
   * nothing), notes the cues it fired in `echoes`, and keeps the input for a replay. The server's tick runs the same
   * order for the unit (`auras.tickAll`, then its motion, where it presses). Returns the mask of the slots that fired.
   * Throws a `RangeError` for a key that is not above the last one stepped. Allocates nothing once the inputs in flight
   * have been held.
   */
  readonly step: (pressed: number, press: MirrorPress<G>) => number;

  /**
   * Reads one snapshot of the server (`MirrorSnapshot`): its cues into `heard`, echoes dropped; then steps the
   * acknowledged bearer over the inputs up to `ack` and compares it with the snapshot (`auras.matchesSeed`). On a
   * difference, it seeds both bearers from the snapshot, calls `onReseed`, and replays the inputs after `ack` on the predicted one,
   * truncating the cues the replay fires again. Then it settles the echoes up to `ack`, handing every predicted cue
   * the server never echoed to `unconfirmed`. Returns whether it reseeded. A snapshot acknowledging less than the last
   * one is stale and ignored (false). Throws a `RangeError` for an `ack` above the last key stepped.
   */
  readonly receive: (snapshot: MirrorSnapshot, unconfirmed?: Unconfirmed) => boolean;
}
