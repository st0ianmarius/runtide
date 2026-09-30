import type { EventKind } from '../core/index.ts';
import type { ActiveAura } from './active-aura.ts';
import type { AuraCause, AuraChange } from './aura-def.ts';
import type { AuraTypes } from './aura-types.ts';

/**
 * The payload of an aura event on the bus: what changed, on which bearer, and the aura. It is reused
 * between raises (the bus's payload reuse), so a listener reads it while it runs and never keeps it.
 */
export interface AuraEvent<G extends AuraTypes = AuraTypes> {
  /** What happened. */
  change: AuraChange;

  /** Why: the operation behind it (a dispel is `removeByTag`, an expiry `tick`, an eviction `evict`). */
  cause: AuraCause;

  /** The bearer; set on every raise. */
  bearer: G['bearer'] | undefined;

  /** The aura; set on every raise, and already off its bearer for `expired` and `removed`. */
  aura: ActiveAura<G> | undefined;

  /** The bearer state entered, for `stateEntered`; `undefined` for any other change. */
  state: G['state'] | undefined;
}

/** Makes an empty aura event payload: the factory a game registers the aura event kind on its bus with. */
export const createAuraEvent = <G extends AuraTypes = AuraTypes>(): AuraEvent<G> => ({
  change: 'applied',
  cause: 'apply',
  bearer: undefined,
  aura: undefined,
  state: undefined,
});

/** The part of a bus the aura system raises its events on (a core `Bus` is one). */
export interface AuraEventBus {
  /** Whether anything hears a kind. */
  readonly hears: (kind: EventKind<unknown>) => boolean;

  /** The reused payload of a kind. */
  readonly payload: <Payload>(kind: EventKind<Payload>) => Payload;

  /** Raises a filled payload. */
  readonly raise: <Payload>(kind: EventKind<Payload>, payload: Payload) => void;
}
