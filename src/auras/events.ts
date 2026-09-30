import { type Bitset, createBitset, type EventKind } from '../core/index.ts';
import { type ActiveAura, type AuraItem, MutableContext } from './active-aura.ts';
import type { AuraHost } from './application.ts';
import type { AuraCause, AuraHook } from './aura-def.ts';
import type { AuraEvent, AuraEventBus } from './aura-event.ts';
import type { AuraTypes } from './aura-types.ts';
import { type AuraTables, CHANGES } from './compile.ts';
import type { AuraRegistry } from './define-auras.ts';
import { isTagEdge, rescaleOn } from './edges.ts';
import { setOf } from './state.ts';

/** The code of a queued beat, after the lifecycle change codes. */
const BEAT = CHANGES.length;

/** The lifecycle hook of each change code. */
const HOOK_NAMES = ['onApplied', 'onRefreshed', 'onExpired', 'onRemoved', 'onState'] as const;

/** Whether a table's state name is one of the game's states: always, for a bit the table handed out. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isState = <G extends AuraTypes>(name: string | undefined): name is G['state'] => name !== undefined;

/** The code of `stateEntered`, whose hook is told the state. */
const STATE_ENTERED = CHANGES.indexOf('stateEntered');

/** What the queue dispatches with. */
export interface EventParts<G extends AuraTypes> {
  /** The aura registry. */
  readonly registry: AuraRegistry<G>;

  /** The compiled tables. */
  readonly tables: AuraTables;

  /** The host. */
  readonly host: AuraHost<G>;

  /** The bus and kind aura events are raised on, if any. */
  readonly events?:
    | {
        /** The bus. */
        readonly bus: AuraEventBus;

        /** The aura event kind on it. */
        readonly changed: EventKind<AuraEvent<G>>;
      }
    | undefined;

  /** Gives an aura's slot back to the pool. */
  readonly release: (item: AuraItem<G>) => void;
}

/**
 * The events of an aura operation, queued in parallel columns (no object per event) and dispatched once the
 * operation has finished, in the order the changes happened: each one runs the aura's hook (its procs
 * handed to the host), then raises on the bus (triggers, then subscribers). Operations nest: a hook that changes
 * auras queues and dispatches its own before it returns, and the outer operation's remaining events after. Slots of
 * auras that left their bearers go back to the pool only once no dispatch is running, so nothing queued can see a
 * reused slot.
 */
export class AuraEvents<G extends AuraTypes> {
  readonly #parts: EventParts<G>;
  readonly #codes: number[] = [];
  readonly #bearers: (G['bearer'] | undefined)[] = [];
  readonly #items: (AuraItem<G> | undefined)[] = [];
  readonly #handles: number[] = [];
  readonly #weights: number[] = [];
  readonly #causes: AuraCause[] = [];
  readonly #openCauses: AuraCause[] = [];
  readonly #retired: (AuraItem<G> | undefined)[] = [];
  readonly #contexts: MutableContext<G>[] = [];
  readonly #heard: readonly Bitset[];
  #contextDepth = 0;
  #dispatching = 0;

  // The columns and the retired list keep their storage between operations and are filled by index up to these
  // counts: shrinking an array to 0 drops its backing store, so every operation would allocate it again.
  #count = 0;
  #retiredCount = 0;

  constructor(parts: EventParts<G>) {
    this.#parts = parts;
    this.#heard = HOOK_NAMES.map((name, code) =>
      createBitset(
        parts.registry.ids.filter(
          (id) =>
            parts.registry.has[name].has(id) ||
            ((parts.tables.rescaleOn[id] ?? 0) & (1 << code)) !== 0 ||
            isTagEdge(parts, code, id),
        ),
      ),
    );
  }

  /** Opens an operation with its cause, which its events carry. Returns where its events start; close it with it. */
  open(cause: AuraCause): number {
    this.#openCauses.push(cause);

    return this.#count;
  }

  /** Changes the cause of the open operation's next events (an application's cleanse and eviction). */
  setCause(cause: AuraCause): void {
    this.#openCauses[this.#openCauses.length - 1] = cause;
  }

  /** Dispatches the open operation's events and closes it. */
  close(from: number): void {
    try {
      this.finish(from);
    } finally {
      this.#openCauses.pop();
    }
  }

  /** Queues a lifecycle change for a bearer that is not silent, when anything hears it. */
  raise(code: number, bearer: G['bearer'], item: AuraItem<G>): void {
    if (this.#isHeard(code, item.id)) {
      this.#queue(code, bearer, item);
    }
  }

  /** Queues a bearer's entry into a state (its bit) for one of its auras, when anything hears it. */
  raiseState(bearer: G['bearer'], item: AuraItem<G>, bit: number): void {
    if (this.#isHeard(STATE_ENTERED, item.id) && this.#queue(STATE_ENTERED, bearer, item)) {
      this.#weights[this.#count - 1] = bit;
    }
  }

  /** Queues a beat for a bearer that is not silent. */
  beat(bearer: G['bearer'], item: AuraItem<G>, weight: number): void {
    if (this.#queue(BEAT, bearer, item)) {
      this.#weights[this.#count - 1] = weight;
    }
  }

  /** Marks an aura as off its bearer; its slot goes back to the pool once no dispatch is running. */
  retire(item: AuraItem<G>): void {
    item.isActive = false;
    this.#retired[this.#retiredCount] = item;
    this.#retiredCount += 1;
  }

  /**
   * Dispatches everything queued since `from`, in order, then gives back the retired slots if nothing else runs. An
   * operation that queued nothing and retired nothing costs two comparisons.
   */
  finish(from: number): void {
    if (this.#count > from) {
      this.#flush(from);
    }

    if (this.#dispatching === 0 && this.#retiredCount > 0) {
      this.#releaseRetired();
    }
  }

  /** Takes the context of the next nesting level, filled for one aura. Give it back with `give`. */
  take(bearer: G['bearer'], aura: ActiveAura<G>): MutableContext<G> {
    const context = this.#contexts[this.#contextDepth] ?? new MutableContext<G>(bearer, aura);

    this.#contexts[this.#contextDepth] = context;
    this.#contextDepth += 1;
    context.bearer = bearer;
    context.aura = aura;
    context.stats = this.#parts.host.statsOf?.(bearer);
    context.cause = this.#openCauses.at(-1) ?? 'apply';

    return context;
  }

  /** Gives back the most recently taken context. */
  give(): void {
    this.#contextDepth -= 1;
  }

  /** Runs procs a hook returned, if there are any and a host runs them. */
  run(procs: readonly G['proc'][] | undefined, context: MutableContext<G>): void {
    if (procs !== undefined && procs.length > 0) {
      this.#parts.host.run?.(procs, context);
    }
  }

  /** Whether anything hears a change of an aura: its hook, its rescale, or the bus. */
  #isHeard(code: number, id: number): boolean {
    const events = this.#parts.events;

    return this.#heard[code]?.has(id) === true || events?.bus.hears(events.changed) === true;
  }

  /** Queues one event, unless the bearer is silent; true when it was queued. */
  #queue(code: number, bearer: G['bearer'], item: AuraItem<G>): boolean {
    if (setOf<G>(bearer).isSilent) {
      return false;
    }

    const i = this.#count;

    this.#codes[i] = code;
    this.#bearers[i] = bearer;
    this.#items[i] = item;
    this.#handles[i] = item.handle;
    this.#weights[i] = 1;
    this.#causes[i] = this.#openCauses.at(-1) ?? 'apply';
    this.#count = i + 1;

    return true;
  }

  /** Dispatches queued event `i`. */
  #dispatch(i: number): void {
    const code = this.#codes[i] ?? 0;
    const bearer = this.#bearers[i];
    const item = this.#items[i];

    if (item === undefined || bearer === undefined) {
      return;
    }

    if (code === BEAT) {
      this.#beat(bearer, item, i);
    } else {
      this.#change(i, bearer, item);
    }
  }

  /** Dispatches a beat, if its aura is still the one it was queued for and its gate lets it fire. */
  #beat(bearer: G['bearer'], item: AuraItem<G>, i: number): void {
    const periodic = this.#parts.registry.defs[item.id]?.periodic;

    if (periodic === undefined || !item.isActive || item.handle !== this.#handles[i]) {
      return;
    }

    const context = this.take(bearer, item);

    context.cause = this.#causes[i] ?? 'tick';

    try {
      if (periodic.when?.(context) !== false) {
        this.run(periodic.onBeat(context, this.#weights[i] ?? 1), context);
      }
    } finally {
      this.give();
    }
  }

  /** Dispatches queued lifecycle change `i`: the rescale, the hook and its procs, then the bus. */
  #change(i: number, bearer: G['bearer'], item: AuraItem<G>): void {
    const code = this.#codes[i] ?? 0;
    const rescale = rescaleOn(this.#parts, code, item);

    if (rescale !== undefined) {
      this.#parts.host.rescaleClocks?.(bearer, rescale);
    }

    if (isTagEdge(this.#parts, code, item.id)) {
      this.#parts.host.onTagsChanged?.(bearer);
    }

    this.#hook(i, bearer, item);
    this.#publish(i, bearer, item);
  }

  /** Runs queued change `i`'s hook, if its aura has one: `onState` told the state, any other with the context alone. */
  #hook(i: number, bearer: G['bearer'], item: AuraItem<G>): void {
    const { hooks } = this.#parts.registry;
    const code = this.#codes[i] ?? 0;
    const onState = code === STATE_ENTERED ? hooks.onState[item.id] : undefined;
    const name = HOOK_NAMES[code];
    const hook: AuraHook<G> | undefined = name === undefined || name === 'onState' ? undefined : hooks[name][item.id];

    if (hook === undefined && onState === undefined) {
      return;
    }

    const context = this.take(bearer, item);

    context.cause = this.#causes[i] ?? 'apply';

    try {
      this.run(onState === undefined ? hook?.(context) : onState(context, this.#stateOf(i)), context);
    } finally {
      this.give();
    }
  }

  /** The state queued `stateEntered` event `i` entered. */
  #stateOf(i: number): G['state'] {
    const name = this.#parts.tables.stateNames[this.#weights[i] ?? 0];

    if (!isState<G>(name)) {
      throw new RangeError('An aura heard a state its system does not have.');
    }

    return name;
  }

  /** Raises queued change `i` on the bus, if anything hears it there. */
  #publish(i: number, bearer: G['bearer'], item: AuraItem<G>): void {
    const events = this.#parts.events;

    if (events === undefined || !events.bus.hears(events.changed)) {
      return;
    }

    const payload = events.bus.payload(events.changed);

    payload.change = CHANGES[this.#codes[i] ?? 0] ?? 'applied';
    payload.cause = this.#causes[i] ?? 'apply';
    payload.bearer = bearer;
    payload.aura = item;
    payload.state = this.#codes[i] === STATE_ENTERED ? this.#stateOf(i) : undefined;
    events.bus.raise(events.changed, payload);
    payload.state = undefined;
  }

  /** Dispatches the events queued since `from`, then drops them (even if a hook throws). */
  #flush(from: number): void {
    this.#dispatching += 1;

    try {
      for (let i = from; i < this.#count; i++) {
        this.#dispatch(i);
      }
    } finally {
      this.#drop(from);
      this.#dispatching -= 1;
    }
  }

  /** Drops the queued events from `from` on, keeping the columns' storage and letting go of their references. */
  #drop(from: number): void {
    for (let i = from; i < this.#count; i++) {
      this.#bearers[i] = undefined;
      this.#items[i] = undefined;
    }

    this.#count = from;
  }

  /** Gives every retired slot back to the pool, in the order they were retired. */
  #releaseRetired(): void {
    const retired = this.#retired;

    // Released one by one and counted down only at the end, so a release that retires more is still walked.
    for (let i = 0; i < this.#retiredCount; i++) {
      const item = retired[i];

      retired[i] = undefined;

      if (item !== undefined) {
        this.#parts.release(item);
      }
    }

    this.#retiredCount = 0;
  }
}
