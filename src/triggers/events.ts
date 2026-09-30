import type { AuraChange, AuraEvent, AuraRegistry } from '../auras/index.ts';
import type { EventKind } from '../core/index.ts';
import type { TriggerTypes } from './trigger-types.ts';

/** One event filter as the trigger system holds it: its test on the payload, and how a named argument resolves. */
export interface TriggerFilterSpec<G extends TriggerTypes> {
  /** Whether the payload passes, for the filter's resolved argument. */
  test(this: void, payload: unknown, arg: number): boolean;

  /** Resolves a named argument (an aura's name) to its number at load; names are refused when absent. */
  resolve?(this: void, arg: string, auras: AuraRegistry<G>): number;
}

/**
 * One trigger event as the trigger system holds it (§II.3.7): the bus kind, which unit the event is about (whose
 * triggers answer it, before its party's), and the filters it carries. Made by `triggerEvent`, which types it.
 */
export interface TriggerEvent<G extends TriggerTypes> {
  /** The bus event kind. */
  readonly kind: EventKind<unknown>;

  /** The unit the event is about: its owner-side triggers answer; `undefined` answers nothing. */
  unit(this: void, payload: unknown): G['bearer'] | undefined;

  /** The filters the event carries, by name; a filter it does not carry fails. */
  readonly filters: Readonly<Record<string, TriggerFilterSpec<G> | undefined>>;
}

/** A filter as a game writes it for a payload type: a test, or a test with a resolver for named arguments. */
export type TriggerFilterOf<Payload, G extends TriggerTypes> =
  | ((payload: Payload, arg: number) => boolean)
  | {
      /** Whether the payload passes. */
      readonly test: (payload: Payload, arg: number) => boolean;

      /** Resolves a named argument at load. */
      readonly resolve?: (arg: string, auras: AuraRegistry<G>) => number;
    };

/** A trigger event as a game writes it, typed by the event kind's payload. */
export interface TriggerEventSpec<Payload, G extends TriggerTypes> {
  /** The unit the event is about. */
  readonly unit: (payload: Payload) => G['bearer'] | undefined;

  /** The filters it carries, by name. */
  readonly filters?: Readonly<Partial<Record<G['filter'], TriggerFilterOf<Payload, G>>>>;
}

/** The held form of one written filter. */
const specOf = <Payload, G extends TriggerTypes>(filter: TriggerFilterOf<Payload, G>): TriggerFilterSpec<G> =>
  typeof filter === 'function' ? { test: filter } : filter;

/**
 * Declares a bus event kind as a trigger event (§II.3.7): `triggerEvent(bus.kind.hit, { unit: (hit) => hit.attacker,
 * filters: { minDamage: (hit, least) => hit.amount >= least } })`. The payload type comes from the kind.
 */
export const triggerEvent = <Payload, G extends TriggerTypes = TriggerTypes>(
  kind: EventKind<Payload>,
  spec: TriggerEventSpec<Payload, G>,
): TriggerEvent<G> => {
  const written: Readonly<Record<string, TriggerFilterOf<Payload, G> | undefined>> = spec.filters ?? {};

  return Object.freeze({
    kind,
    unit: spec.unit,
    filters: Object.freeze(
      Object.fromEntries(
        Object.entries(written).flatMap(([name, filter]) => (filter === undefined ? [] : [[name, specOf(filter)]])),
      ),
    ),
  });
};

/** The lifecycle changes, in the aura system's code order: a `change` filter's argument is one of them, by name. */
const CHANGES: readonly AuraChange[] = ['applied', 'refreshed', 'expired', 'removed', 'stateEntered'];

/** Resolves a change's name to its code. */
const changeCode = (name: string): number => {
  const names: readonly string[] = CHANGES;
  const code = names.indexOf(name);

  if (code < 0) {
    throw new RangeError(`unknown aura change ${name}.`);
  }

  return code;
};

/** Resolves an aura's name to its id. */
const auraCode = <G extends TriggerTypes>(name: string, auras: AuraRegistry<G>): number => {
  const ids: Readonly<Record<string, number | undefined>> = auras.id;
  const id = ids[name];

  if (id === undefined) {
    throw new RangeError(`unknown aura ${name}.`);
  }

  return id;
};

/**
 * The aura lifecycle event (`createAuraEvent`) as a trigger event: it is about the aura's bearer, and carries two
 * filters, `aura` (the aura that changed, by name or id) and `change` (`applied`, `refreshed`, `expired`, `removed`
 * or `stateEntered`). An aura's own triggers never hear its own end, since it is already off its bearer.
 */
export const auraTriggerEvent = <G extends TriggerTypes>(kind: EventKind<AuraEvent<G>>): TriggerEvent<G> =>
  Object.freeze({
    kind,
    unit: (event: AuraEvent<G>) => event.bearer,

    filters: Object.freeze({
      aura: { test: (event: AuraEvent<G>, id: number) => event.aura?.id === id, resolve: auraCode },
      change: { test: (event: AuraEvent<G>, code: number) => CHANGES[code] === event.change, resolve: changeCode },
    }),
  });
