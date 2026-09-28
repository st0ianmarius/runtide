/**
 * Branded ids: plain numbers at runtime, told apart by the compiler. This file and the adapters are the only places
 * that may cast (§I.4.2), because a brand can only be put on a number by an assertion.
 */

declare const registryBrand: unique symbol;

declare const payloadBrand: unique symbol;

declare const handleBrand: unique symbol;

/**
 * A dense numeric id handed out by the registry of kind `Kind`: its position in that registry. Two registries of
 * different kinds give ids the compiler keeps apart, at no runtime cost.
 */
export type Id<Kind extends string> = number & {
  /** The kind of registry the id belongs to; it exists only in the type system. */
  readonly [registryBrand]: Kind;
};

/**
 * The numeric id of one event kind on a bus, carrying the payload type `Payload` in the type system so that
 * subscribing and raising stay typed while the runtime works with small integers.
 */
export type EventKind<Payload> = number & {
  /** The payload the kind carries; it exists only in the type system. */
  readonly [payloadBrand]: Payload;
};

/**
 * A generational handle into a pool of `Item`: the slot index and the slot's generation packed into one number, so a
 * handle kept after its item was released is detected as stale instead of reaching the slot's next occupant.
 */
export type Handle<Item> = number & {
  /** The item type of the pool the handle belongs to; it exists only in the type system. */
  readonly [handleBrand]: Item;
};

/** Brands `index` as an id of registry kind `Kind`. Only registries call it. */
export const toId = <Kind extends string>(index: number): Id<Kind> => index as Id<Kind>;

/** Brands `index` as the event kind carrying `Payload`. Only buses call it. */
export const toEventKind = <Payload>(index: number): EventKind<Payload> => index as EventKind<Payload>;

/** Brands a packed slot and generation as a handle into a pool of `Item`. Only pools call it. */
export const toHandle = <Item>(packed: number): Handle<Item> => packed as Handle<Item>;

/** Reads a value a bus stored under an event kind as that kind's payload: the kind's brand is what ties the two. */
export const payloadOf = <Payload>(_kind: EventKind<Payload>, value: unknown): Payload => value as Payload;

/** Reads a listener a bus stored under an event kind as a listener of that kind's payload. */
export const listenerOf = <Payload>(_kind: EventKind<Payload>, listener: unknown): ((payload: Payload) => void) =>
  listener as (payload: Payload) => void;
