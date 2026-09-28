import type { AuraId, AuraSystem } from '../auras/index.ts';
import { toHandle } from '../core/ids.ts';
import { createPool, createScratch, type Pool, type Random, type Scratch } from '../core/index.ts';
import { type CueBuffer, type CueSpec, fireCue } from '../cues/index.ts';
import type { Proc, ProcOutcome, ProcSystem } from '../procs/index.ts';
import type { ProcReturn, SpellClock, SpellId, SpellSystem } from '../spells/index.ts';
import { ProcList } from '../spells/proc-out.ts';
import type { WorldQuery } from '../world/index.ts';
import type { EndReason } from './area-def.ts';
import type { AreaTriggerHost } from './area-host.ts';
import { type AreaServices, AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import { AreaCastOptions } from './caster.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';
import type { AreaLedger } from './delivery-def.ts';
import { type AreaEngineParts, AreaPlace, missing, OwnerAuraApplication } from './engine-parts.ts';
import type { AreaTriggerEvent, AreaTriggerEvents } from './events.ts';
import { Catcher } from './hits.ts';
import { type AreaTriggerHandle, toAreaTriggerHandle } from './ids.ts';
import { LedgerBook, LedgerView } from './ledgers.ts';
import type { SharedClock } from './pulses.ts';

/**
 * The area trigger machinery's shared state (§I.5.4): the registry and its resolved tables, the pool, each kind's
 * tick-order list and creation-order list, the per-owner counts, the reusable proc lists and snapshots, and the area
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
  readonly bindings: Uint8Array;
  readonly pool: Pool<AreaTrigger<G>>;

  /** The head and tail of each kind's tick-order list (its own and its after-parent children). */
  readonly tickHeads: (AreaTrigger<G> | undefined)[];
  readonly tickTails: (AreaTrigger<G> | undefined)[];

  /** The head and tail of each kind's list in creation order. */
  readonly kindHeads: (AreaTrigger<G> | undefined)[];
  readonly kindTails: (AreaTrigger<G> | undefined)[];

  /** The snapshots of handles a step walks, one per nesting level. */
  readonly handles: Scratch<AreaTriggerHandle> = createScratch();

  /** Each kind's first slot among every kind's pulses, which a shared clock is found at. */
  readonly pulseBase: readonly number[];

  /** Each kind's own spell, for a kind that casts. */
  readonly casterSpells: readonly (SpellId | undefined)[];

  /** The options an area trigger casts with, reused. */
  readonly castOptions = new AreaCastOptions<G>();

  /** The clocks shared by every instance of a kind, by pulse slot. */
  readonly globalClocks: (SharedClock | undefined)[] = [];

  /** The hit ledgers. */
  readonly ledgers = new LedgerBook();

  /** The hits and world query options of catches, by nesting level. */
  readonly catcher = new Catcher<G>();

  /** The area trigger whose hook's procs are running now, which a spawn names as its parent; none outside. */
  current: AreaTrigger<G> | undefined = undefined;

  readonly #procs: ProcSystem<G> | (() => ProcSystem<G>);
  readonly #random: Random | undefined;
  readonly #streams: AreaEngineParts<G>['streams'];
  readonly #resetExt: AreaEngineParts<G>['resetExt'];
  readonly #counts = new Map<G['bearer'], Uint16Array>();
  readonly #ownerClocks = new Map<G['bearer'], (SharedClock | undefined)[]>();
  readonly #lists: ProcList<G>[] = [];
  readonly #place = new AreaPlace();
  #depth = 0;
  #nextId = 1;
  #pending: G['bearer'] | undefined = undefined;
  #application: OwnerAuraApplication | undefined = undefined;
  #view: LedgerView<G> | undefined = undefined;

  constructor(parts: AreaEngineParts<G>) {
    const kinds = parts.registry.size;

    this.registry = parts.registry;
    this.spells = parts.spells;
    this.auras = parts.auras;
    this.world = parts.world;
    this.clock = parts.clock;
    this.host = parts.host;
    this.events = parts.events;
    this.cues = parts.cues;
    this.ownerAuras = parts.ownerAuras;
    this.slotKinds = parts.slotKinds;
    this.bindings = parts.bindings;
    this.pulseBase = parts.pulseBase;
    this.casterSpells = parts.casterSpells;
    this.tickHeads = Array.from({ length: kinds }, () => undefined);
    this.tickTails = Array.from({ length: kinds }, () => undefined);
    this.kindHeads = Array.from({ length: kinds }, () => undefined);
    this.kindTails = Array.from({ length: kinds }, () => undefined);
    this.#procs = parts.procs;
    this.#random = parts.random;
    this.#streams = parts.streams;
    this.#resetExt = parts.resetExt;
    this.pool = createPool({
      create: () => new AreaTrigger<G>(this, this.#pending ?? missing('an owner'), parts.createExt()),
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
    area.isEnding = false;
    area.pending = undefined;

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

  /** The clocks an owner's instances share, by pulse slot, made on first use. */
  ownerClocks(owner: G['bearer']): (SharedClock | undefined)[] {
    let clocks = this.#ownerClocks.get(owner);

    if (clocks === undefined) {
      clocks = [];
      this.#ownerClocks.set(owner, clocks);
    }

    return clocks;
  }

  /** How many area triggers of a kind an owner has. */
  countOf(owner: G['bearer'], kind: number): number {
    return this.#counts.get(owner)?.[kind] ?? 0;
  }

  /** Counts one more (or one fewer) of a kind for an owner. */
  count(owner: G['bearer'], [kind, by]: readonly [number, number]): void {
    let counts = this.#counts.get(owner);

    if (counts === undefined) {
      counts = new Uint16Array(this.registry.size);
      this.#counts.set(owner, counts);
    }

    counts[kind] = (counts[kind] ?? 0) + by;

    if (by < 0 && counts.every((n) => n === 0)) {
      this.#counts.delete(owner);
    }
  }

  /** Puts an ended area trigger's record back: its state, the game's fields, its references. */
  free(area: AreaTrigger<G>): void {
    this.#resetExt?.(area.ext);
    area.cast = undefined;
    area.state = undefined;
    area.input = undefined;
    area.tickNext = undefined;
    area.tickPrev = undefined;
    area.kindNext = undefined;
    area.kindPrev = undefined;
    area.lastChild = undefined;
    area.locked = undefined;
    area.placer.clear();
    this.pool.release(toHandle<AreaTrigger<G>>(area.handle));
  }

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

    const view = (this.#view ??= new LedgerView<G>(this));

    view.ledger = ledger;
    view.holder = area.handle;

    return view;
  };

  readonly randomFor = (area: AreaTrigger<G>, stream: G['stream'] | undefined): Random =>
    stream === undefined
      ? (this.#random ?? missing('random stream of its own'))
      : (this.#streams ?? missing('named streams'))(stream, area.key());

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
  raise(kind: 'spawned' | 'ended', area: AreaTrigger<G>, reason?: EndReason): void {
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
   * Puts its kind's owner aura on its owner as the first of the kind arrives (§II.3.7), and takes it off as the last
   * leaves, so overlapping instances share one; call it after the count went up, or after it went down.
   */
  holdOwnerAura(area: AreaTrigger<G>, isOn: boolean): void {
    const aura = this.ownerAuras[area.kind];

    if (aura === undefined || this.countOf(area.owner, area.kind) !== (isOn ? 1 : 0)) {
      return;
    }

    if (!isOn) {
      this.auras.remove(area.owner, aura);

      return;
    }

    const application = (this.#application ??= new OwnerAuraApplication(aura));

    application.aura = aura;
    application.source = area.ownerId;
    this.auras.apply(area.owner, application);
  }
}
