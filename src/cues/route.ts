import type { CueRegistry } from './define-cues.ts';
import type { CueEvent } from './event.ts';

/** The audience column code of `owner`. */
const OWNER = 0;

/** The audience column code of `party`. */
const PARTY = 1;

/**
 * One client a server routes cues to: its unit's entity id, what else it owns (its summons and pets) and, for `party`
 * cues, its party.
 */
export interface CueRecipient {
  /** The entity id of the recipient's own unit. */
  readonly id: number;

  /**
   * Whether the recipient owns the entity a cue is credited to: a summon's or a pet's cue carries the summon's entity
   * id, which is not the recipient's `id`, so its owning player is asked here (a game answers it from
   * `units.creditOf`, or its own ownership map). Nothing beyond `id` when absent.
   */
  readonly owns?: (owner: number) => boolean;

  /** Whether the recipient shares a party with an owner; nobody else does when absent. */
  readonly sharesParty?: (owner: number) => boolean;
}

/**
 * Whether an event reaches a recipient by its cue's audience: an `all` cue (every `world` cue is one) reaches
 * everyone; an `owner` cue its owner, that is a recipient whose `id` is the cue's owner or who `owns` it (a pet's
 * cue reaches the pet's player); a `party` cue its owner so found and whoever shares the owner's party. The server's
 * routing, as `encodeCues`'s `admit`.
 */
export const cueReaches = (registry: CueRegistry, event: CueEvent, recipient: CueRecipient): boolean => {
  const audience = registry.columns.audience[event.cue];

  if (audience !== OWNER && audience !== PARTY) {
    return true;
  }

  if (recipient.id === event.owner || recipient.owns?.(event.owner) === true) {
    return true;
  }

  return audience === PARTY && (recipient.sharesParty?.(event.owner) ?? false);
};

/**
 * The predicted cues a client fired ahead of the server, so it drops their echoes: the server's copy of a
 * predicted cue carries the same cue, owner and key. A fixed ring of the latest ones; nothing allocates once made.
 */
export interface CueEchoes {
  /**
   * Notes an event the client fired itself; one with no key (0) or of a cue that is not predicted is not noted. Press
   * keys count from 1, increase with each press and never wrap, since `settle` compares them as numbers.
   */
  readonly note: (event: CueEvent) => void;

  /** Whether a received event is the echo of a noted one; a match is forgotten, so each echo is dropped once. */
  readonly isEcho: (event: CueEvent) => boolean;

  /**
   * Settles the noted events the server has had its chance to confirm: every one whose key is at or below `key` (the
   * last press the server acknowledged) and was not echoed is handed to `unconfirmed` (a predicted cast bar to cancel,
   * a miss to count) and forgotten. Returns how many. Call it after reading the same snapshot's cue events, so an echo
   * that snapshot carries is matched before its press is settled.
   */
  readonly settle: (key: number, unconfirmed?: (cue: number, owner: number, key: number) => void) => number;

  /** Forgets every noted event. */
  readonly clear: () => void;
}

/**
 * Creates an empty echo ring over a cue registry, with room for `capacity` predicted events awaiting their echoes (64
 * by default); it doubles rather than drop one still waiting.
 */
export const createCueEchoes = (registry: CueRegistry, capacity = 64): CueEchoes => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`Cue echoes need a whole capacity from 1; got ${capacity}.`);
  }

  let cues = new Float64Array(capacity).fill(-1);
  let owners = new Float64Array(capacity);
  let keys = new Float64Array(capacity);
  let next = 0;

  // The next free slot from `next` on; the ring doubles when every slot waits on its echo, so none is lost.
  const freeSlot = (): number => {
    for (let i = 0; i < cues.length; i++) {
      const slot = (next + i) % cues.length;

      if (cues[slot] === -1) {
        return slot;
      }
    }

    const size = cues.length;

    cues = Float64Array.from({ length: size * 2 }, (_slot, i) => cues[i] ?? -1);
    owners = Float64Array.from({ length: size * 2 }, (_slot, i) => owners[i] ?? 0);
    keys = Float64Array.from({ length: size * 2 }, (_slot, i) => keys[i] ?? 0);

    return size;
  };

  const isNoted = (event: CueEvent): boolean => registry.columns.isPredicted[event.cue] === 1 && event.key !== 0;

  return {
    note: (event) => {
      if (isNoted(event)) {
        const slot = freeSlot();

        cues[slot] = event.cue;
        owners[slot] = event.owner;
        keys[slot] = event.key;
        next = (slot + 1) % cues.length;
      }
    },

    isEcho: (event) => {
      if (!isNoted(event)) {
        return false;
      }

      for (let i = 0; i < cues.length; i++) {
        if (cues[i] === event.cue && keys[i] === event.key && owners[i] === event.owner) {
          cues[i] = -1;

          return true;
        }
      }

      return false;
    },

    settle: (key, unconfirmed) => {
      let settled = 0;

      for (let i = 0; i < cues.length; i++) {
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
    }
  };
};
