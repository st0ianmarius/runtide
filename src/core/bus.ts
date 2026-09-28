import { type EventKind, listenerOf, payloadOf, toEventKind } from './ids.ts';

/** A listener of one event kind. It reads the payload while it is called and never keeps it: the payload is reused. */
export type Listener<Payload> = (payload: Payload) => void;

/** What a bus is created with, beyond its payload factories. */
export interface BusOptions {
  /** How deep capped handlers nest: at this depth and beyond they no longer run; 3 by default, as swarm's triggers. */
  readonly maxDepth?: number;
}

/** The event kinds of a bus, by name: each a small integer carrying its payload type. */
export type EventKinds<Factories> = {
  readonly [Name in keyof Factories]: Factories[Name] extends () => infer Payload ? EventKind<Payload> : never;
};

/**
 * A typed event bus (§I.5, §I.5.4). Every kind has a small integer id and one reused payload per nesting level, so
 * raising an event allocates nothing. Two tiers hear an event: capped handlers first (the triggers), which stop
 * running past the depth cap, then subscribers in subscription order, which hear every event at any depth.
 */
export interface Bus<Factories> {
  /** The id of every event kind, by name, in the key order of the factories. */
  readonly kind: EventKinds<Factories>;

  /** How deep capped handlers are nested right now: 0 outside any. */
  readonly depth: number;

  /** Whether anything hears `kind`: one array read, so an event site with no listener fills and raises nothing. */
  readonly hears: (kind: EventKind<unknown>) => boolean;

  /**
   * The reused payload of `kind` for the next raise at the current nesting level of that kind; made once per level
   * by the kind's factory, then reused. Fill it, then `raise` it.
   */
  readonly payload: <Payload>(kind: EventKind<Payload>) => Payload;

  /** Raises a filled payload: capped handlers first (while under the depth cap), then every subscriber. */
  readonly raise: <Payload>(kind: EventKind<Payload>, payload: Payload) => void;

  /** Adds a capped handler (a trigger dispatcher); returns the function that removes it. */
  readonly handle: <Payload>(kind: EventKind<Payload>, handler: Listener<Payload>) => () => void;

  /** Adds a subscriber, which hears past the depth cap too; returns the function that removes it. */
  readonly on: <Payload>(kind: EventKind<Payload>, subscriber: Listener<Payload>) => () => void;
}

/** One kind's listeners: replaced, never mutated, on add and remove, so removing one mid-raise is safe. */
interface Channel {
  /** The capped handlers, in the order they were added. */
  handlers: readonly unknown[];

  /** The subscribers, in the order they were added. */
  subscribers: readonly unknown[];

  /** The kind's payload factory. */
  readonly make: () => object;

  /** The reused payloads, one per nesting level of this kind. */
  readonly payloads: object[];

  /** How deep this kind is being raised right now: the index of the next free payload. */
  level: number;

  /** How many handlers and subscribers the kind has. */
  count: number;
}

/** Adds a listener to one tier of a channel and returns the function that removes it (once). */
const addTo = (channel: Channel, tier: 'handlers' | 'subscribers', listener: unknown): (() => void) => {
  channel[tier] = [...channel[tier], listener];
  channel.count += 1;

  return () => {
    if (channel[tier].includes(listener)) {
      channel[tier] = channel[tier].filter((other) => other !== listener);
      channel.count -= 1;
    }
  };
};

/** Whether a record of kind ids holds every factory's name, which types it as the bus's kinds. */
const isKinds = <Factories>(
  record: Readonly<Record<string, EventKind<unknown>>>,
  factories: Factories & object,
): record is EventKinds<Factories> => Object.keys(factories).every((name) => Object.hasOwn(record, name));

/** Calls every listener of a kind with its payload, in order. */
const callAll = <Payload>(kind: EventKind<Payload>, listeners: readonly unknown[], payload: Payload): void => {
  for (const listener of listeners) {
    listenerOf(kind, listener)(payload);
  }
};

/** The event kinds of a factory table, by name, in key order. */
const kindsOf = <Factories extends Readonly<Record<string, () => object>>>(
  factories: Factories,
): EventKinds<Factories> => {
  const kinds = Object.freeze(
    Object.fromEntries(Object.keys(factories).map((name, index) => [name, toEventKind<unknown>(index)])),
  );

  if (!isKinds(kinds, factories)) {
    throw new Error('An event kind was lost while the bus was built.');
  }

  return kinds;
};

/**
 * Creates a bus from one payload factory per event kind (`{ hit: () => ({ target: 0, amount: 0 }) }`). A factory
 * returns a fresh payload with every field set, so each kind keeps one object shape.
 */
export const createBus = <const Factories extends Readonly<Record<string, () => object>>>(
  factories: Factories,
  options: BusOptions = {},
): Bus<Factories> => {
  const maxDepth = options.maxDepth ?? 3;

  const channels: Channel[] = Object.values(factories).map((make) => ({
    handlers: [],
    subscribers: [],
    make,
    payloads: [],
    level: 0,
    count: 0,
  }));

  let depth = 0;

  const channelOf = (kind: number): Channel => {
    const channel = channels[kind];

    if (channel === undefined) {
      throw new RangeError(`${kind} is not an event kind of this bus.`);
    }

    return channel;
  };

  const raise = <Payload>(kind: EventKind<Payload>, payload: Payload): void => {
    const channel = channelOf(kind);
    const { handlers, subscribers } = channel;

    channel.level += 1;

    try {
      if (handlers.length > 0 && depth < maxDepth) {
        depth += 1;

        try {
          callAll(kind, handlers, payload);
        } finally {
          depth -= 1;
        }
      }

      callAll(kind, subscribers, payload);
    } finally {
      channel.level -= 1;
    }
  };

  return {
    kind: kindsOf(factories),

    get depth() {
      return depth;
    },

    hears: (kind) => (channels[kind]?.count ?? 0) > 0,

    payload: (kind) => {
      const channel = channelOf(kind);
      const payload = channel.payloads[channel.level] ?? channel.make();

      channel.payloads[channel.level] = payload;

      return payloadOf(kind, payload);
    },

    raise,
    handle: (kind, handler) => addTo(channelOf(kind), 'handlers', handler),
    on: (kind, subscriber) => addTo(channelOf(kind), 'subscribers', subscriber),
  };
};
