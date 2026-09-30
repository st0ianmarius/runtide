import { type CueRegistry, WORLD } from './define-cues.ts';
import type { CueEvent } from './event.ts';

/** The audience column code of `owner`. */
const OWNER = 0;

/** The audience column code of `party`. */
const PARTY = 1;

/** One client a server routes cues to: its unit's entity id and, for `party` cues, its party. */
export interface CueRecipient {
  /** The entity id of the recipient's own unit. */
  readonly id: number;

  /** Whether the recipient shares a party with an owner; nobody else does when absent. */
  readonly sharesParty?: (owner: number) => boolean;
}

/**
 * Whether an event reaches a recipient by its cue's audience: a `world` cue and an `all` cue reach
 * everyone, an `owner` cue its owner alone, a `party` cue its owner and whoever shares the owner's party. The server's
 * routing, as `encodeCues`'s `admit`.
 */
export const cueReaches = (registry: CueRegistry, event: CueEvent, recipient: CueRecipient): boolean => {
  const audience = registry.columns.audience[event.cue];

  if (registry.columns.anchor[event.cue] === WORLD || (audience !== OWNER && audience !== PARTY)) {
    return true;
  }

  if (recipient.id === event.owner) {
    return true;
  }

  return audience === PARTY && (recipient.sharesParty?.(event.owner) ?? false);
};

/**
 * The predicted cues a client fired ahead of the server, so it drops their echoes: the server's copy of a
 * predicted cue carries the same cue, owner and key. A fixed ring of the latest ones; nothing allocates once made.
 */
export interface CueEchoes {
  /** Notes an event the client fired itself; one with no key (0) or of a cue that is not predicted is not noted. */
  readonly note: (event: CueEvent) => void;

  /** Whether a received event is the echo of a noted one; a match is forgotten, so each echo is dropped once. */
  readonly isEcho: (event: CueEvent) => boolean;

  /**
   * Settles the noted events the server has had its chance to confirm: every one whose key is at or below `key` (the
   * last press the server acknowledged) and was not echoed is handed to `unconfirmed` (a predicted cast bar to cancel,
   * a miss to count) and forgotten. Returns how many.
   */
  readonly settle: (key: number, unconfirmed?: (cue: number, owner: number, key: number) => void) => number;

  /** Forgets every noted event. */
  readonly clear: () => void;
}

/** Creates an empty echo ring over a cue registry, holding the latest `capacity` predicted events (64 by default). */
export const createCueEchoes = (registry: CueRegistry, capacity = 64): CueEchoes => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`Cue echoes need a whole capacity from 1; got ${capacity}.`);
  }

  const cues = new Float64Array(capacity).fill(-1);
  const owners = new Float64Array(capacity);
  const keys = new Float64Array(capacity);
  let next = 0;

  const isNoted = (event: CueEvent): boolean => registry.columns.isPredicted[event.cue] === 1 && event.key !== 0;

  return {
    note: (event) => {
      if (isNoted(event)) {
        cues[next] = event.cue;
        owners[next] = event.owner;
        keys[next] = event.key;
        next = (next + 1) % capacity;
      }
    },

    isEcho: (event) => {
      if (!isNoted(event)) {
        return false;
      }

      for (let i = 0; i < capacity; i++) {
        if (cues[i] === event.cue && keys[i] === event.key && owners[i] === event.owner) {
          cues[i] = -1;

          return true;
        }
      }

      return false;
    },

    settle: (key, unconfirmed) => {
      let settled = 0;

      for (let i = 0; i < capacity; i++) {
        if ((cues[i] ?? -1) >= 0 && (keys[i] ?? 0) <= key) {
          unconfirmed?.(cues[i] ?? -1, owners[i] ?? 0, keys[i] ?? 0);
          cues[i] = -1;
          settled += 1;
        }
      }

      return settled;
    },

    clear: () => {
      cues.fill(-1);
    },
  };
};
