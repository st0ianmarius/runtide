import { toHandle, toId } from '../core/ids.ts';
import type { Handle } from '../core/index.ts';
import type { StatView } from '../modifiers/index.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';

/** The source of an aura applied without one. */
export const NO_SOURCE = -1;

/**
 * One aura running on one bearer, as hooks, events and queries see it. Nothing may keep it past the call that handed
 * it over: once it leaves its bearer its slot goes back to the pool, and `handle` tells a kept reference apart from
 * the slot's next aura.
 */
export interface ActiveAura<G extends AuraTypes = AuraTypes> {
  /** The aura's registry id. */
  readonly id: AuraId;

  /** A generational handle to this instance, stale once it has left its bearer. */
  readonly handle: Handle<ActiveAura>;

  /** Tells instances of one aura apart (`independent` and per-source ones); 0 for the one shared instance. */
  readonly serial: number;

  /** Its stacks, at least 1. */
  readonly stacks: number;

  /** Its value: an amount that is not a stack count, such as the damage an absorb has left. */
  readonly value: number;

  /** The length of the application that last set its clock, in seconds; `Infinity` for an infinite aura. */
  readonly duration: number;

  /** The tick of its bearer's clock on which it runs out; `Infinity` for an infinite aura. */
  readonly end: number;

  /** The id of the clock its lifetime counts on, in the order the system's clocks were declared. */
  readonly clock: number;

  /** Who applied it (an entity id), or `NO_SOURCE`. */
  readonly source: number;

  /** Whether it is still on its bearer: false from the moment it is removed or expires. */
  readonly isActive: boolean;

  /** The game's own fields (§I.5.6, hatch 4), made by the system's `createExt`; the framework never reads them. */
  readonly ext: G['ext'];
}

/**
 * What every aura hook receives (§II.6 A11): the bearer, the aura with its stacks, value and game fields, and the
 * bearer's stats. It is reused between calls, so a hook reads it while it runs and never keeps it.
 */
export interface AuraContext<G extends AuraTypes = AuraTypes> {
  /** The bearer the aura is on. */
  readonly bearer: G['bearer'];

  /** The aura the hook belongs to. */
  readonly aura: ActiveAura<G>;

  /** The bearer's stats, when the host reports them; `undefined` otherwise. */
  readonly stats: StatView | undefined;
}

/** The mutable instance behind an `ActiveAura`, pooled by its system. */
export class AuraItem<G extends AuraTypes> implements ActiveAura<G> {
  id: AuraId = toId<'auras'>(0);
  handle: Handle<AuraItem<G>> = toHandle<AuraItem<G>>(0);
  serial = 0;
  stacks = 1;
  value = 0;
  duration = 0;
  end = 0;
  clock = 0;
  source = NO_SOURCE;
  isActive = false;
  readonly ext: G['ext'];

  /** Seconds until its next periodic beat, counted down on the beat's clock. */
  nextBeat = 0;

  constructor(ext: G['ext']) {
    this.ext = ext;
  }
}

/** The one mutable context, reused per nesting level of hook calls. */
export class MutableContext<G extends AuraTypes> implements AuraContext<G> {
  bearer: G['bearer'];
  aura: ActiveAura<G>;
  stats: StatView | undefined = undefined;

  constructor(bearer: G['bearer'], aura: ActiveAura<G>) {
    this.bearer = bearer;
    this.aura = aura;
  }
}
