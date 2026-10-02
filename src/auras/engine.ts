// Hot path: list walks run every tick, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { createPool, type Pool, stepsUntil } from '../core/index.ts';
import { type ActiveAura, AuraItem, NO_SOURCE } from './active-aura.ts';
import type { AuraApplication, AuraHost } from './application.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';
import type { AuraTables } from './compile.ts';
import { type AuraRegistry, BOUND_TO_SOURCE } from './define-auras.ts';
import { AuraEvents, type EventParts } from './events.ts';
import type { AuraSet } from './state.ts';

/** What an engine is built from. */
export interface EngineParts<G extends AuraTypes> extends Omit<EventParts<G>, 'release'> {
  /** Makes the game's fields for a pooled aura. */
  readonly createExt: () => G['ext'];

  /** Clears the game's fields as an aura's slot goes back to the pool. */
  readonly resetExt: ((ext: G['ext']) => void) | undefined;
}

/**
 * The aura machinery's shared state: the registry, its compiled tables, the pool of aura slots, the event queue and
 * the host. The operations (`apply.ts`, `remove.ts`, `tick.ts`) are functions over it.
 */
export class AuraEngine<G extends AuraTypes> {
  readonly registry: AuraRegistry<G>;
  readonly tables: AuraTables;
  readonly host: AuraHost<G>;
  readonly pool: Pool<AuraItem<G>>;
  readonly events: AuraEvents<G>;
  readonly stacking: ArrayLike<number>;
  readonly maxStacks: ArrayLike<number>;
  readonly merge: ArrayLike<number>;
  readonly flags: ArrayLike<number>;
  readonly #applications: AuraApplication<G>[] = [];

  /** Whether the instance a spend just took from is now empty and goes: what `spendOne` reads. */
  isSpentEmpty = false;

  /**
   * By source, the bearers holding `boundToSource` auras from it, with how many each: what `sourceLeft` sweeps, so a
   * source leaving costs the bearers it bound, not every bearer. A bearer is dropped once it holds none from it.
   */
  readonly #bound = new Map<number, Map<G['bearer'], number>>();

  /** What `watchRemovals` registered: each hears an aura come off a bearer. */
  readonly removalWatchers: ((bearer: G['bearer'], aura: AuraId) => void)[] = [];

  readonly #resetExt: ((ext: G['ext']) => void) | undefined;

  constructor(parts: EngineParts<G>) {
    const { registry } = parts;

    this.registry = registry;
    this.tables = parts.tables;
    this.host = parts.host;
    this.#resetExt = parts.resetExt;
    this.pool = createPool({ create: () => new AuraItem<G>(parts.createExt()) });
    this.events = new AuraEvents<G>({
      ...parts,

      release: (item) => {
        this.#release(item);
      }
    });
    this.stacking = registry.columns.stacking;
    this.maxStacks = registry.columns.maxStacks;
    this.merge = registry.columns.merge;
    this.flags = registry.columns.flags;

    for (const id of registry.ids) {
      this.#applications[id] = Object.freeze({ aura: id });
    }
  }

  /** Notes an aura on a bearer under its source, when it is bound to its source (`boundToSource`) and has one. */
  bind(bearer: G['bearer'], item: AuraItem<G>): void {
    if (!this.#isBound(item)) {
      return;
    }

    let bearers = this.#bound.get(item.source);

    if (bearers === undefined) {
      bearers = new Map();
      this.#bound.set(item.source, bearers);
    }

    bearers.set(bearer, (bearers.get(bearer) ?? 0) + 1);
  }

  /** Forgets what `bind` noted for an aura leaving its bearer or its source. */
  unbind(bearer: G['bearer'], item: AuraItem<G>): void {
    const bearers = this.#isBound(item) ? this.#bound.get(item.source) : undefined;
    const count = bearers?.get(bearer) ?? 0;

    if (bearers === undefined || count === 0) {
      return;
    }

    if (count > 1) {
      bearers.set(bearer, count - 1);

      return;
    }

    bearers.delete(bearer);

    if (bearers.size === 0) {
      this.#bound.delete(item.source);
    }
  }

  /** The bearers holding auras bound to a source, as a list of their own (a sweep changes the index as it goes). */
  boundTo(source: number): G['bearer'][] {
    return [...(this.#bound.get(source)?.keys() ?? [])];
  }

  /** Whether an aura is bound to a source it has. */
  #isBound(item: AuraItem<G>): boolean {
    return item.source !== NO_SOURCE && ((this.flags[item.id] ?? 0) & BOUND_TO_SOURCE) !== 0;
  }

  /** Tells every removal watcher an aura came off a bearer. */
  noteRemoved(bearer: G['bearer'], aura: AuraId): void {
    const watchers = this.removalWatchers;

    for (let i = 0; i < watchers.length; i++) {
      watchers[i]?.(bearer, aura);
    }
  }

  /** The plain application of an aura id, made once at load, so applying by id allocates nothing. */
  applicationOf(id: AuraId): AuraApplication<G> {
    return this.#applications[id] ?? { aura: id };
  }

  /** The definition's own length for one application, in seconds. Throws for an aura with none. */
  lengthOf(id: AuraId, bearer: G['bearer']): number {
    const { duration } = this.registry.get(id);

    if (typeof duration === 'function') {
      return duration(bearer);
    }

    if (duration === undefined) {
      throw new RangeError(`Aura ${this.registry.name(id)} has no length of its own: the application must give one.`);
    }

    return duration === 'infinite' ? Infinity : duration;
  }

  /** The ticks `seconds` take on an aura's clock: its cached length when it is the definition's own. */
  stepsFor(item: AuraItem<G>, seconds: number): number {
    const fixed = this.tables.fixedSteps[item.id] ?? -1;

    if (fixed >= 0 && this.registry.defs[item.id]?.duration === seconds) {
      return fixed;
    }

    const clock = this.tables.clocks[item.clock];

    return clock === undefined ? 0 : stepsUntil(seconds, clock.dt);
  }

  /** Sets an aura's clock to run out `seconds` from now (an end stamp on its bearer's clock), and its duration with it. */
  setClock(set: AuraSet<G>, item: AuraItem<G>, seconds: number): void {
    if (!(seconds >= 0)) {
      throw new RangeError(`Aura ${this.registry.name(item.id)}: a length must be seconds from 0; got ${seconds}.`);
    }

    item.duration = seconds;
    item.end = Number.isFinite(seconds) ? (set.clocks[item.clock] ?? 0) + this.stepsFor(item, seconds) : Infinity;
    set.noteEnd(item);
  }

  /** The seconds left on an aura: its ticks left times its clock's step; `Infinity` for an infinite one. */
  remainingOf(set: AuraSet<G>, item: ActiveAura): number {
    if (item.end === Infinity) {
      return Infinity;
    }

    const now = set.clocks[item.clock] ?? 0;

    return now >= item.end ? 0 : (item.end - now) * (this.tables.clocks[item.clock]?.dt ?? 0);
  }

  /** Whether an aura has run out: its bearer's clock is at or past its stamp. */
  isDue(set: AuraSet<G>, item: AuraItem<G>): boolean {
    return item.end !== Infinity && (set.clocks[item.clock] ?? 0) >= item.end;
  }

  /** Takes a clean aura slot from the pool for `id`. */
  acquire(id: AuraId): AuraItem<G> {
    const handle = this.pool.acquire();
    const item = this.pool.get(handle);

    if (item === undefined) {
      throw new Error('The aura pool lost a slot it had just handed out.');
    }

    item.id = id;
    item.handle = handle;
    item.clock = this.tables.clock[id] ?? 0;
    item.isActive = true;

    return item;
  }

  /** Rebuilds a bearer's tag bitset from its auras. */
  refreshTags(set: AuraSet<G>): void {
    const { items, tags } = set;

    tags.clear();

    for (let i = 0; i < items.length; i++) {
      const bits = this.tables.tagBits[items[i]?.id ?? 0];

      if (bits !== undefined && !bits.isEmpty()) {
        tags.union(bits);
      }
    }
  }

  /** Inserts an aura keeping registry order, after the instances of its own aura already there, counting its beats. */
  insert(set: AuraSet<G>, item: AuraItem<G>): void {
    const { items } = set;
    const beatClock = this.tables.beatClock[item.id] ?? -1;
    let at = items.length;

    if (beatClock >= 0) {
      set.beats[beatClock] = (set.beats[beatClock] ?? 0) + 1;
    }

    set.buckets[item.id & 31] = (set.buckets[item.id & 31] ?? 0) + 1;
    items.push(item);

    while (at > 0 && (items[at - 1]?.id ?? 0) > item.id) {
      items[at] = items[at - 1] ?? item;
      at -= 1;
    }

    items[at] = item;
  }

  /** Gives an aura's slot back to the pool, clearing the game's fields. */
  #release(item: AuraItem<G>): void {
    item.isActive = false;
    this.#resetExt?.(item.ext);
    this.pool.release(item.handle);
  }
}
