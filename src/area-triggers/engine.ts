import type { AuraId, AuraSystem } from '../auras/index.ts';
import { toHandle } from '../core/ids.ts';
import { createPool, createScratch, type Pool, type Random, type Scratch } from '../core/index.ts';
import { type CueBuffer, type CueSpec, fireCue } from '../cues/index.ts';
import type { Vec2 } from '../math/index.ts';
import type { Proc, ProcOutcome, ProcSystem } from '../procs/index.ts';
import type { ProcReturn, SpellClock, SpellSystem } from '../spells/index.ts';
import { ProcList } from '../spells/proc-out.ts';
import type { WorldQuery } from '../world/index.ts';
import { AuraHolds } from './area-auras.ts';
import type { EndReason } from './area-def.ts';
import type { AreaTriggerHost } from './area-host.ts';
import { type AreaServices, AreaTrigger, NO_SCALED, NO_STATS } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';
import type { AreaLedger } from './delivery-def.ts';
import { type AreaEngineParts, AreaPlace, missing, OwnerAuraApplication } from './engine-parts.ts';
import type { AreaTriggerEvent, AreaTriggerEvents } from './events.ts';
import { placeShape } from './frame.ts';
import { Catcher } from './hits.ts';
import { type AreaTriggerHandle, toAreaTriggerHandle } from './ids.ts';
import { type Ledger, LedgerBook, LedgerView } from './ledgers.ts';
import { OwnerAreas } from './order.ts';
import { AreaQueryApi } from './queries.ts';

/**
 * The area trigger machinery's shared state: the registry and its resolved tables, the pool, each kind's
 * list in creation order (its tick order), each owner's counts and lists, the reusable proc lists and snapshots, and the area
 * trigger whose procs are running. Spawning, stepping and ending (`spawner.ts`, `stepper.ts`, `ender.ts`) are
 * functions over it.
 */
export class AreaEngine<G extends AreaTriggerTypes> implements AreaServices<G> {
  readonly registry: AreaTriggerRegistry<G>;
  readonly spells: SpellSystem<G>;
  readonly auras: AuraSystem<G>;
  readonly world: WorldQuery<G['bearer']>;
  readonly clock: SpellClock;
  readonly host: AreaTriggerHost<G> & G['host'];
  readonly events: AreaTriggerEvents<G> | undefined;
  readonly cues: CueBuffer | undefined;
  readonly ownerAuras: readonly (AuraId | undefined)[];
  readonly slotKinds: readonly (readonly number[])[];
  readonly pool: Pool<AreaTrigger<G>>;

  /** The head and tail of each kind's list in creation order, which is also its tick order. */
  readonly kindHeads: (AreaTrigger<G> | undefined)[];
  readonly kindTails: (AreaTrigger<G> | undefined)[];

  /** The snapshots of handles a step walks, one per nesting level. */
  readonly handles: Scratch<AreaTriggerHandle> = createScratch();

  /** The records a query collects, one list per nesting level. */
  readonly records: Scratch<AreaTrigger<G>> = createScratch();

  /** The queries over the area triggers, which hooks read as `c.areas`. */
  readonly queries: AreaQueryApi<G>;

  /**
   * The spawns whose limit is ending an older trigger to make room, innermost last: each holds its room, so a spawn
   * the ending's hooks make of the same owner and kind finds the limit full.
   */
  readonly admitting: AreaTrigger<G>[] = [];

  /** The hit ledgers. */
  readonly ledgers = new LedgerBook((cast) => this.spells.get(cast) !== undefined);

  /** How many enter-exit area auras hold each unit's aura. */
  readonly auraHolds = new AuraHolds<G['bearer']>();

  /** Each kind's auras' ids, by aura index. */
  readonly areaAuras: readonly (readonly AuraId[] | undefined)[];

  /** The hits and world query options of catches, by nesting level. */
  readonly catcher = new Catcher<G>();

  /** The point an owner's position is read into, read at once. */
  readonly point = { x: 0, z: 0 };

  /** The area trigger whose hook's procs are running now, which a spawn names as its parent; none outside. */
  current: AreaTrigger<G> | undefined = undefined;

  readonly #procs: ProcSystem<G> | (() => ProcSystem<G>);
  readonly #random: Random | undefined;
  readonly #streams: AreaEngineParts<G>['streams'];
  readonly #resetExt: AreaEngineParts<G>['resetExt'];
  readonly #owners = new Map<G['bearer'], OwnerAreas<G>>();

  /** Owner records given back as their owners' last area trigger ended, reused by the next owner to spawn one. */
  readonly #spareOwners: OwnerAreas<G>[] = [];
  readonly #lists: ProcList<G>[] = [];
  readonly #place = new AreaPlace();
  #depth = 0;
  #holds = 0;
  #nextId = 1;

  /** Ended records waiting for every hook on them to return before they go back to the pool. */
  readonly #retired: AreaTrigger<G>[] = [];
  #pending: G['bearer'] | undefined = undefined;
  #application: OwnerAuraApplication | undefined = undefined;

  /** How many ends are raising their end event with their kind's owner aura still on (see `release`). */
  #releasing = 0;

  /** A view per pooled ledger, so two views a hook holds stay apart. */
  readonly #views = new Map<Ledger, LedgerView<G>>();

  constructor(parts: AreaEngineParts<G>) {
    const kinds = parts.registry.size;

    this.registry = parts.registry;
    this.spells = parts.spells;
    this.auras = parts.auras;
    this.auras.watchRemovals((bearer, aura) => {
      this.auraHolds.noteRemoved(bearer, aura);
    });
    this.world = parts.world;
    this.clock = parts.clock;
    this.host = parts.host;
    this.events = parts.events;
    this.cues = parts.cues;
    this.ownerAuras = parts.ownerAuras;
    this.slotKinds = parts.slotKinds;
    this.areaAuras = parts.areaAuras;
    this.queries = new AreaQueryApi<G>(this);
    this.kindHeads = Array.from({ length: kinds }, () => undefined);
    this.kindTails = Array.from({ length: kinds }, () => undefined);
    this.#procs = parts.procs;
    this.#random = parts.random;
    this.#streams = parts.streams;
    this.#resetExt = parts.resetExt;
    this.pool = createPool({
      create: () => new AreaTrigger<G>(this, this.#pending ?? missing('an owner'), parts.createExt())
    });
  }

  get tick(): number {
    return this.clock.tick;
  }

  get dt(): number {
    return this.clock.dt;
  }

  /** The proc system, resolved on first use. */
  get procs(): ProcSystem<G> {
    const procs = this.#procs;

    return typeof procs === 'function' ? procs() : procs;
  }

  /** Takes an area trigger from the pool for an owner. */
  acquire(owner: G['bearer']): AreaTrigger<G> {
    this.#pending = owner;

    const handle = this.pool.acquire();
    const area = this.pool.get(handle) ?? missing('a pooled area trigger');

    this.#pending = undefined;
    area.handle = toAreaTriggerHandle(handle);
    area.owner = owner;
    area.origin.self = owner;
    area.origin.target = owner;
    area.id = -1;
    area.isEnding = false;
    area.pending = undefined;
    area.successor = undefined;
    area.keepsOwnerAura = false;

    return area;
  }

  /** The live area trigger behind a handle, or `undefined` when it is stale. */
  areaOf(handle: AreaTriggerHandle): AreaTrigger<G> | undefined {
    const area = this.pool.get(toHandle<AreaTrigger<G>>(handle));

    return area === undefined || area.isEnding ? undefined : area;
  }

  /** The record behind a handle, ending ones included, or `undefined` when it is stale. */
  recordOf(handle: AreaTriggerHandle): AreaTrigger<G> | undefined {
    return this.pool.get(toHandle<AreaTrigger<G>>(handle));
  }

  /** The next entity id: the host's shared counter's, or the system's own. */
  allocateId(): number {
    const allocate = this.host.allocateId;

    if (allocate !== undefined) {
      return allocate();
    }

    const id = this.#nextId;

    this.#nextId += 1;

    return id;
  }

  /** What an owner has live: its counts by kind and its lists; `undefined` for an owner with none. */
  ownerOf(owner: G['bearer']): OwnerAreas<G> | undefined {
    return this.#owners.get(owner);
  }

  /** What an owner has live, taken (a spare record, else a new one) on its first area trigger. */
  ownerFor(owner: G['bearer']): OwnerAreas<G> {
    let owned = this.#owners.get(owner);

    if (owned === undefined) {
      owned = this.#spareOwners.pop() ?? new OwnerAreas<G>(this.registry.size);
      this.#owners.set(owner, owned);
    }

    return owned;
  }

  /** How many area triggers of a kind an owner has. */
  countOf(owner: G['bearer'], kind: number): number {
    return this.#owners.get(owner)?.counts[kind] ?? 0;
  }

  /**
   * Counts one more (or one fewer) of a kind for an owner. An owner left with none is forgotten, and its record kept
   * for the next owner, so a caster whose telegraph ends before its next cast allocates nothing.
   */
  count(owner: G['bearer'], kind: number, by: number): void {
    const owned = this.ownerFor(owner);

    owned.counts[kind] = (owned.counts[kind] ?? 0) + by;
    owned.total += by;

    if (owned.total <= 0) {
      this.#owners.delete(owner);
      owned.clear();
      this.#spareOwners.push(owned);
    }
  }

  /**
   * Holds ended records out of the pool until the matching `unhold`: a walk, a step or a hook that ends an area
   * trigger (its own or another's) never sees the record taken by a spawn before it returns. Calls nest.
   */
  hold(): void {
    this.#holds += 1;
  }

  /** Lets go of a `hold`; the outermost puts every record that ended meanwhile back into the pool. */
  unhold(): void {
    this.#holds -= 1;

    if (this.#holds > 0) {
      return;
    }

    const retired = this.#retired;

    for (const area of retired) {
      this.#release(area);
    }

    retired.length = 0;
  }

  /** Puts an ended area trigger's record back, at once or as the outermost hold lets go. */
  free(area: AreaTrigger<G>): void {
    area.isEnding = true;

    if (this.#holds > 0) {
      this.#retired.push(area);
    } else {
      this.#release(area);
    }
  }

  /** Clears a record (its state, the game's fields, its references) and gives it to the pool. */
  #release(area: AreaTrigger<G>): void {
    this.#resetExt?.(area.ext);
    this.spells.giveStats(area.statsBox);

    area.cast = undefined;
    area.statsBox = undefined;
    area.stats = NO_STATS;
    area.scaled = NO_SCALED;
    area.state = undefined;
    area.input = undefined;
    area.kindNext = undefined;
    area.kindPrev = undefined;
    area.ownerNext = undefined;
    area.ownerPrev = undefined;
    area.hasAdvanced = false;
    area.advancedAt = 0;
    area.placer.clear();

    this.pool.release(toHandle<AreaTrigger<G>>(area.handle));
  }

  /** Sweeps an area trigger's contact along its piece from `previous` to `position`: set by the frame module. */
  contactAlong: (area: AreaTrigger<G>) => void = () => undefined;

  readonly advanceFor = (area: AreaTrigger<G>, to: Vec2, at = 1): void => {
    // Read first: `to` may be its own `previous`, which this overwrites.
    const { x, z } = to;

    if (!(Number.isFinite(x) && Number.isFinite(z))) {
      throw new RangeError(`An area trigger advances to a finite point; got ${x}, ${z}.`);
    }

    if (!(at >= area.advancedAt && at <= 1)) {
      throw new RangeError(`An area trigger advances to a share of its frame from ${area.advancedAt} to 1; got ${at}.`);
    }

    area.previous.x = area.position.x;
    area.previous.z = area.position.z;
    area.position.x = x;
    area.position.z = z;
    placeShape(this, area);

    // One asked to end moves on, and reaches no one.
    if (!area.isEnding && area.pending === undefined) {
      area.sweepUntil = at;

      try {
        this.contactAlong(area);
      } finally {
        area.sweepUntil = 1;
      }
    }

    area.previous.x = x;
    area.previous.z = z;
    area.advancedAt = at;
    area.hasAdvanced = true;
  };

  readonly applyFor = (area: AreaTrigger<G>, proc: Proc<G>): ProcOutcome => {
    const outer = this.current;
    const previous = this.spells.enter(area.castHandle);

    this.current = area;

    try {
      return this.procs.apply(proc, area.origin);
    } finally {
      this.current = outer;
      this.spells.leave(previous);
    }
  };

  readonly ledgerFor = (area: AreaTrigger<G>, name: string): AreaLedger<G['bearer']> => {
    const ledger = area.ledgers.get(name);

    if (ledger === undefined) {
      throw new RangeError(`Area trigger ${this.registry.name(area.kind)} has no ledger ${name}.`);
    }

    let view = this.#views.get(ledger);

    if (view === undefined) {
      view = new LedgerView<G>(this);
      view.ledger = ledger;
      this.#views.set(ledger, view);
    }

    return view;
  };

  readonly randomFor = (stream: G['stream'] | undefined, key: readonly number[]): Random =>
    stream === undefined
      ? (this.#random ?? missing('random stream of its own'))
      : (this.#streams ?? missing('named streams'))(stream, key);

  /** Takes the reusable proc list of the next nesting level; give it back with `giveList`. */
  takeList(): ProcList<G> {
    const list = (this.#lists[this.#depth] ??= new ProcList<G>());

    this.#depth += 1;

    return list;
  }

  /** Gives back the list `takeList` handed out last, clearing it. */
  giveList(list: ProcList<G>): void {
    list.clear();
    this.#depth -= 1;
  }

  /**
   * Runs what a hook returned for its area trigger, as its owner's procs credited to it, with it and its cast current
   * while they run: a list, or the reusable `list` it was handed. Returns how many went off.
   */
  run(area: AreaTrigger<G>, result: ProcReturn<G>, list: ProcList<G>): number {
    const procs = Array.isArray(result) ? result : list.items;

    if (procs.length === 0) {
      return 0;
    }

    const outer = this.current;
    const previous = this.spells.enter(area.castHandle);

    this.current = area;

    try {
      return this.procs.run(procs, area.origin);
    } finally {
      this.current = outer;
      this.spells.leave(previous);
    }
  }

  /** Fires a cue a hook returned, at the area trigger's position, credited to its owner; nothing for `undefined`. */
  fire(area: AreaTrigger<G>, spec: CueSpec | undefined): void {
    if (spec === undefined) {
      return;
    }

    const place = this.#place;

    place.owner = area.ownerId;
    place.entity = area.id;
    place.x = area.position.x;
    place.z = area.position.z;
    fireCue(this.cues ?? missing('cue buffer'), spec, place);
  }

  /** Raises one of the area trigger events, when something hears it. */
  raise(kind: 'spawned' | 'ended', area: AreaTrigger<G>, reason?: EndReason<G>): void {
    const events = this.events;
    const event = events?.[kind];

    if (events === undefined || event === undefined || !events.bus.hears(event)) {
      return;
    }

    const payload: AreaTriggerEvent<G> = events.bus.payload(event);

    payload.areaTrigger = area;
    payload.reason = reason;
    events.bus.raise(event, payload);
  }

  /**
   * Raises an ending area trigger's end event, then takes its kind's owner aura off when it was the last; call it
   * after the count went down. The aura is still on as the event is raised, so its own triggers hear its kind's last
   * end; a spawn of its kind from a listener finds the aura on and keeps it.
   */
  release(area: AreaTrigger<G>, reason: EndReason<G>): void {
    this.#releasing++;

    try {
      this.raise('ended', area, reason);
    } finally {
      this.#releasing--;
      this.holdOwnerAura(area, false);
    }
  }

  /**
   * Puts its kind's owner aura on its owner as the first of the kind arrives, and takes it off as the last
   * leaves, so overlapping instances share one; call it after the count went up, or after it went down. The last one
   * ending to make room for a spawn of its kind leaves the aura on for that spawn, whose entry then finds it on; so
   * does the last one ending as a listener of its end event spawns its kind.
   */
  holdOwnerAura(area: AreaTrigger<G>, isOn: boolean): void {
    const aura = this.ownerAuras[area.kind];
    const isKept = area.keepsOwnerAura;

    area.keepsOwnerAura = false;

    if (aura === undefined || this.countOf(area.owner, area.kind) !== (isOn ? 1 : 0)) {
      return;
    }

    if (!isOn && area.successor !== undefined) {
      area.successor.keepsOwnerAura = true;

      return;
    }

    if (!isOn) {
      this.auras.remove(area.owner, aura);

      return;
    }

    if ((isKept || this.#releasing > 0) && this.auras.has(area.owner, aura)) {
      return;
    }

    const application = (this.#application ??= new OwnerAuraApplication(aura));

    application.aura = aura;
    application.source = area.ownerId;
    this.auras.apply(area.owner, application);
  }
}
