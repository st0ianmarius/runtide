import type { AuraSystem, AuraView, ViewOptions } from '../auras/index.ts';
import {
  createByteWriter,
  type CueBuffer,
  type CueEvent,
  cueReaches,
  type CueRecipient,
  encodeCues
} from '../cues/index.ts';
import type { GameTypes } from './spec.ts';

/**
 * What a server sends one predicting client after a tick, and what its mirror's `receive` reads: the client's own
 * bearer's aura views and header, the key of the last input the server consumed from it, and the tick's cues that
 * reach it. It is an aura seed as it stands (`views`, `count`, `clocks`, `serials`), so the mirror compares and seeds
 * from it without copying. A transport carries its numbers and bytes as it likes; `createSnapshot` makes one to fill.
 */
export interface MirrorSnapshot {
  /**
   * The key of the last input the server consumed from this client (`Press.key`), 0 before the first: the views are
   * the bearer as it stood after that input's step.
   */
  ack: number;

  /** The bearer's aura views, as its owner sees them (`auras.view(bearer, views, { for: 'owner' })`), from index 0. */
  readonly views: AuraView[];

  /** How many of `views` are this snapshot's. */
  count: number;

  /** The bearer's steps on each clock as the views were taken (`auras.headerOf`), by clock id. */
  readonly clocks: number[];

  /** The serials the bearer had handed out (`auras.headerOf`). */
  serials: number;

  /**
   * The tick's cue events that reach this client, as one `encodeCues` batch (bytes); empty for none. A server's
   * writer reuses its bytes, so read or copy them before its next write.
   */
  cues: Uint8Array;
}

/** No cues: an empty batch. */
const NO_CUES = new Uint8Array(0);

/** An empty snapshot, acknowledging nothing, for a server to fill (`SnapshotWriter.write`) or a transport to decode into. */
export const createSnapshot = (): MirrorSnapshot => ({
  ack: 0,
  views: [],
  count: 0,
  clocks: [],
  serials: 0,
  cues: NO_CUES
});

/** What a server writes one client's snapshots from. */
export interface SnapshotSource {
  /** The buffer the game's spells fire their cues into (`GameSpec.spells.cues`); no cues are sent when absent. */
  readonly cues?: CueBuffer | undefined;

  /**
   * The client the cues are routed to (`cueReaches`): its unit's entity id, what else it owns, its party. Every event
   * is sent when absent.
   */
  readonly recipient?: CueRecipient | undefined;
}

/** The server's half of the prediction contract: writes one client's snapshots, reusing its records and bytes. */
export interface SnapshotWriter<G extends GameTypes> {
  /**
   * Fills `out` for the client's bearer after a tick, before the tick's cues are cleared: `ack`, the bearer's owner
   * views and header, and the tick's cues that reach the client, encoded. Returns `out`. Throws a `RangeError` for an
   * `ack` that is not a whole number from 0. A steady bearer's write allocates nothing but its bytes' view.
   */
  readonly write: (bearer: G['bearer'], ack: number, out: MirrorSnapshot) => MirrorSnapshot;
}

/** The owner's view: every aura of the bearer. */
const OWNER: ViewOptions = Object.freeze({ for: 'owner' });

/**
 * Makes the server's snapshot writer for one predicting client: over the game's aura system, the cue buffer its spells
 * fire into and the client to route them to (`SnapshotSource`). The server calls `write` once per tick for that client,
 * after the tick's steps and before it clears the cue buffer, with the key of the last input it consumed from it.
 */
export const createSnapshotWriter = <G extends GameTypes>(
  auras: Pick<AuraSystem<G>, 'view' | 'headerOf'>,
  source: SnapshotSource = {}
): SnapshotWriter<G> => {
  const bytes = createByteWriter();
  const { cues, recipient } = source;

  const admit =
    recipient === undefined || cues === undefined
      ? undefined
      : (event: CueEvent): boolean => cueReaches(cues.registry, event, recipient);

  return {
    write: (bearer, ack, out) => {
      if (!Number.isSafeInteger(ack) || ack < 0) {
        throw new RangeError(`A snapshot acknowledges a whole input key from 0; got ${ack}.`);
      }

      out.ack = ack;
      out.count = auras.view(bearer, out.views, OWNER);
      auras.headerOf(bearer, out);

      if (cues === undefined) {
        out.cues = NO_CUES;

        return out;
      }

      bytes.reset();
      encodeCues(cues, bytes, admit);
      out.cues = bytes.bytes();

      return out;
    }
  };
};
