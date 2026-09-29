import type { EventKind } from '../core/index.ts';
import { type CombatEntry, type CombatEntryKind, EntryRecord } from './entry.ts';
import {
  areaRecorder,
  castRecorder,
  recordAura,
  recordBlow,
  recordDeath,
  recordHeal,
  type Recording,
} from './recorders.ts';
import { EntryStore } from './store.ts';
import type { AreaLogEvents, AuraEventView, DamageLogEvents, SpellLogEvents } from './views.ts';

/** A combat log subscriber: handed each entry as it is recorded, reused, so it reads the entry at once. */
export type CombatLogListener = (entry: CombatEntry) => void;

/** The bus the log listens on: any bus with `on` (a core `Bus` is one). */
export interface CombatLogBus {
  /** Subscribes to a kind; returns the unsubscribe. */
  readonly on: <Payload>(kind: EventKind<Payload>, listener: (payload: Payload) => void) => () => void;
}

/** How many entries a log holds when its options say nothing. */
const DEFAULT_CAPACITY = 4096;

/** What a combat log is built from (§I.7.1 F11): the bus and the event kinds it records, the clock, and ids. */
export interface CombatLogOptions<Unit, Spell = unknown> {
  /** The bus the systems raise their events on. */
  readonly bus: CombatLogBus;

  /** The clock whose tick stamps each entry. */
  readonly clock: {
    /** The tick now. */
    readonly tick: number;
  };

  /** A unit's entity id. */
  readonly idOf: (unit: Unit) => number;

  /** A spell's id, from what a blow, heal or death carries as its spell; a number as it is, else −1, when absent. */
  readonly spellIdOf?: (spell: Spell) => number;

  /** How many of the latest entries it holds; 4,096 when absent. */
  readonly capacity?: number;

  /** The damage system's event kinds it records. */
  readonly damage?: DamageLogEvents<Unit, Spell>;

  /** The aura system's lifecycle event kind (`AuraSystemBase.events.kind`). */
  readonly auras?: EventKind<AuraEventView<Unit>>;

  /** The spell system's event kinds it records. */
  readonly spells?: SpellLogEvents<Unit>;

  /** The area trigger system's event kinds it records. */
  readonly areaTriggers?: AreaLogEvents<Unit>;
}

/**
 * A combat log (§I.7.1 F11): a structured stream of every blow, immunity, heal, death, aura change, cast moment and
 * area trigger spawn and end, as ids and numbers, in the order they happened. It keeps the latest entries in a ring
 * and hands each to its subscribers as it is recorded: a damage meter, a test, an analytics sink.
 */
export interface CombatLog {
  /** How many entries it holds at most. */
  readonly capacity: number;

  /** How many entries it holds now. */
  readonly size: number;

  /** How many entries were ever recorded: the next entry's running number. */
  readonly total: number;

  /** The running number of the oldest entry it holds. */
  readonly first: number;

  /** Fills `out` with the entry of a running number; false when it is not held. `out` comes from `createEntry`. */
  readonly read: (seq: number, out: CombatEntry) => boolean;

  /** A blank entry to read into. */
  readonly createEntry: () => CombatEntry;

  /** Subscribes to every entry recorded from now on; returns the unsubscribe. */
  readonly subscribe: (listener: CombatLogListener) => () => void;

  /** A 32-bit hash of every held entry's numbers, oldest first: what a golden test compares. */
  readonly checksum: () => string;

  /** Forgets every entry (a new encounter); subscribers stay. */
  readonly clear: () => void;

  /** Stops listening to the bus; the entries stay readable. */
  readonly close: () => void;
}

/** Whether a public entry is one the log made, which it may read into. */
const isRecord = (entry: CombatEntry): entry is EntryRecord => entry instanceof EntryRecord;

/** The default spell id: a number as it is, anything else −1. */
const plainSpellId = (spell: unknown): number => (typeof spell === 'number' ? spell : -1);

/** Subscribes the recorders of every event kind the options name; returns the unsubscribes. */
const listen = <Unit, Spell>(
  options: CombatLogOptions<Unit, Spell>,
  recording: Recording<Unit, Spell>,
): (() => void)[] => {
  const { bus, damage, spells, areaTriggers } = options;
  const offs: (() => void)[] = [];

  const on = <Payload>(kind: EventKind<Payload> | undefined, listener: (payload: Payload) => void): void => {
    if (kind !== undefined) {
      offs.push(bus.on(kind, listener));
    }
  };

  on(damage?.taken, (event) => {
    recordBlow(recording, event.blow);
  });
  on(damage?.ignored, (event) => {
    recordBlow(recording, event.blow);
  });
  on(damage?.healed, (event) => {
    recordHeal(recording, event.heal);
  });
  on(damage?.death, (event) => {
    recordDeath(recording, event.death);
  });
  on(options.auras, (event) => {
    recordAura(recording, event);
  });

  const casts: readonly (readonly [keyof SpellLogEvents<Unit>, CombatEntryKind])[] = [
    ['start', 'castStart'],
    ['release', 'castRelease'],
    ['hit', 'castHit'],
    ['end', 'castEnd'],
  ];

  for (const [name, kind] of casts) {
    on(spells?.[name], castRecorder(recording, kind));
  }

  on(areaTriggers?.spawned, areaRecorder(recording, 'areaSpawned'));
  on(areaTriggers?.ended, areaRecorder(recording, 'areaEnded'));

  return offs;
};

/** A combat log: a class for fast properties, its functions arrow fields so they work detached. */
class Log<Unit, Spell> implements CombatLog {
  readonly capacity: number;
  readonly #store: EntryStore;
  readonly #entry = new EntryRecord();
  readonly #offs: (() => void)[];
  #listeners: readonly CombatLogListener[] = [];

  constructor(options: CombatLogOptions<Unit, Spell>) {
    const store = new EntryStore(options.capacity ?? DEFAULT_CAPACITY);
    const spellIdOf = options.spellIdOf ?? plainSpellId;

    this.capacity = store.capacity;
    this.#store = store;
    this.#offs = listen(options, {
      begin: (kind) => this.#entry.begin(kind, options.clock.tick),

      commit: () => {
        store.push(this.#entry);

        for (const listener of this.#listeners) {
          listener(this.#entry);
        }
      },

      idOf: (unit) => (unit === undefined ? -1 : options.idOf(unit)),
      spellOf: (spell) => (spell === undefined ? -1 : spellIdOf(spell)),
    });
  }

  get size(): number {
    return this.#store.size;
  }

  get total(): number {
    return this.#store.total;
  }

  get first(): number {
    return this.#store.first;
  }

  readonly read = (seq: number, out: CombatEntry): boolean => {
    if (!isRecord(out)) {
      throw new TypeError('A combat log reads into an entry made by log.createEntry().');
    }

    return this.#store.read(seq, out);
  };

  readonly createEntry = (): CombatEntry => new EntryRecord();

  readonly subscribe = (listener: CombatLogListener): (() => void) => {
    this.#listeners = [...this.#listeners, listener];

    return () => {
      this.#listeners = this.#listeners.filter((other) => other !== listener);
    };
  };

  readonly checksum = (): string => this.#store.checksum();

  readonly clear = (): void => {
    this.#store.clear();
  };

  readonly close = (): void => {
    for (const off of this.#offs.splice(0)) {
      off();
    }
  };
}

/**
 * Creates a combat log over a game's bus (§I.7.1 F11): `createCombatLog({ bus, clock, idOf, damage: { taken:
 * bus.kind.taken, healed: bus.kind.healed, death: bus.kind.death }, auras: bus.kind.aura, spells: { … } })`. It
 * subscribes to every kind named (so the systems raise them) and records each as an entry. A subscriber added or
 * removed while an entry is handed out takes effect from the next one.
 */
export const createCombatLog = <Unit, Spell = unknown>(options: CombatLogOptions<Unit, Spell>): CombatLog =>
  Object.freeze(new Log(options));
