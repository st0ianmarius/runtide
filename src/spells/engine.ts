import { type AuraApplication, type AuraId, type AuraSystem, NO_SOURCE } from '../auras/index.ts';
import { toHandle } from '../core/ids.ts';
import { createPool, type Pool, type Random } from '../core/index.ts';
import type { CueBuffer, CueEvent, CuePlace, CueSpec } from '../cues/index.ts';
import { fireCue } from '../cues/index.ts';
import type { StatView } from '../modifiers/index.ts';
import type { Proc, ProcOutcome, ProcSystem } from '../procs/index.ts';
import type { CastPlan } from './cast-plan.ts';
import { Cast, type CastServices, NO_SCALED, NO_STATS, StatsCall } from './cast.ts';
import { recordOf } from './caster.ts';
import type { SpellRegistry } from './define-spells.ts';
import { DelayedProcs } from './delayed.ts';
import type { SpellEvent, SpellEvents } from './events.ts';
import { type CastHandle, NO_CAST, toCastHandle } from './ids.ts';
import type { MirrorContext, StaticWorld } from './mirror.ts';
import { missing } from './missing.ts';
import { ProcList } from './proc-out.ts';
import type { ProcReturn, SpellHit } from './spell-def.ts';
import type { SpellHost } from './spell-host.ts';
import type { SpellTypes } from './spell-types.ts';
import type { StatsBoxes } from './stats-box.ts';

/** The clock spells count on: the host's fixed-step clock (a core `SimClock` is one). */
export interface SpellClock {
  /** The tick now. */
  readonly tick: number;

  /** The fixed step in seconds. */
  readonly dt: number;
}

/** The application a cast aura lands with, reused. */
class CastAuraApplication implements AuraApplication {
  aura: AuraId;
  source = NO_SOURCE;

  constructor(aura: AuraId) {
    this.aura = aura;
  }
}

/** Where a spell's cues sit: on the caster, credited to it. */
class CasterPlace implements CuePlace {
  owner = 0;
  entity = 0;
  x = 0;
  z = 0;
}

/** What an engine is built from: the resolved options and tables of a system. */
export interface EngineParts<G extends SpellTypes> {
  /** The spells. */
  readonly registry: SpellRegistry<G>;

  /** The aura system cast auras land through. */
  readonly auras: AuraSystem<G>;

  /** The proc system hooks' procs run through, or a function returning it (resolved on first use). */
  readonly procs: ProcSystem<G> | (() => ProcSystem<G>);

  /** The clock. */
  readonly clock: SpellClock;

  /** The host. */
  readonly host: SpellHost<G> & G['host'];

  /** The spells' own stream. */
  readonly random: Random | undefined;

  /** The host's named streams, keyed by the cast's key. */
  readonly streams: ((stream: G['stream'], key: readonly number[]) => Random) | undefined;

  /** The events. */
  readonly events: SpellEvents<G> | undefined;

  /** The cue buffer. */
  readonly cues: CueBuffer | undefined;

  /** The static world mirror-safe cast cues read. */
  readonly world: StaticWorld;

  /** Each spell's plan, by id. */
  readonly plans: readonly (CastPlan<G> | undefined)[];

  /** Each spell's cast aura, by id; `undefined` for none. */
  readonly castAuras: readonly (AuraId | undefined)[];

  /** The free stats boxes. */
  readonly boxes: StatsBoxes;

  /** The view a cast reads when the host has no `statsOf`. */
  readonly baseView: StatView;

  /** The pause bit of every interrupt, by name. */
  readonly interruptBits: ReadonlyMap<string, number>;

  /** 1 for each `auto` spell whose clock resets after the caster's other casts end, by spell id. */
  readonly resetsAfterCast: Uint8Array;

  /** How many tick slots delayed procs land in (the game's tick slots); 1 when it declares none. */
  readonly slots: number;

  /** Makes the game's fields of a pooled cast. */
  readonly createExt: () => G['castExt'];

  /** Clears the game's fields as a cast's slot goes back to the pool. */
  readonly resetExt: ((ext: G['castExt']) => void) | undefined;
}

/**
 * The spell machinery's shared state: the registry and its resolved tables, the pool of casts, the stack of
 * reusable proc lists, the cast whose procs are running, the cue place and the host. The cast order and the timeline
 * (`runner.ts`, `stepper.ts`) are functions over it.
 */
export class SpellEngine<G extends SpellTypes> implements CastServices<G> {
  readonly registry: SpellRegistry<G>;
  readonly auras: AuraSystem<G>;
  readonly clock: SpellClock;
  readonly host: SpellHost<G> & G['host'];
  readonly events: SpellEvents<G> | undefined;
  readonly cues: CueBuffer | undefined;
  readonly world: StaticWorld;
  readonly plans: readonly (CastPlan<G> | undefined)[];
  readonly castAuras: readonly (AuraId | undefined)[];
  readonly boxes: StatsBoxes;
  readonly baseView: StatView;
  readonly pool: Pool<Cast<G>>;

  /** What `stats` functions are called with, reused. */
  readonly statsCall = new StatsCall<G>();

  /** The pause bit of every interrupt a spell's timeline names, from bit 1 up, by name. */
  readonly interruptBits: ReadonlyMap<string, number>;

  /** 1 for each `auto` spell whose clock resets after a cast (`afterCast: 'reset'`), by spell id. */
  readonly resetsAfterCast: Uint8Array;

  /** Whether any `auto` spell resets after casts. */
  readonly hasResets: boolean;

  /** The delayed procs, on a timing wheel per tick slot. */
  readonly delayed: DelayedProcs<G>;

  /** The mirror context mirror-safe cast cues are handed, made on first use. */
  mirror: MirrorContext<G> | undefined = undefined;

  /** The cast whose hook's procs are running now, which a delayed or `castSpell` proc belongs to; none outside. */
  current: Cast<G> | undefined = undefined;

  readonly #procs: ProcSystem<G> | (() => ProcSystem<G>);
  readonly #random: Random | undefined;
  readonly #streams: EngineParts<G>['streams'];
  readonly #resetExt: EngineParts<G>['resetExt'];
  readonly #lists: ProcList<G>[] = [];
  readonly #handles: CastHandle[][] = [];
  #handleDepth = 0;
  readonly #place = new CasterPlace();
  #application: CastAuraApplication | undefined = undefined;
  #depth = 0;
  #pending: G['bearer'] | undefined = undefined;

  constructor(parts: EngineParts<G>) {
    this.registry = parts.registry;
    this.auras = parts.auras;
    this.clock = parts.clock;
    this.host = parts.host;
    this.events = parts.events;
    this.cues = parts.cues;
    this.world = parts.world;
    this.plans = parts.plans;
    this.castAuras = parts.castAuras;
    this.boxes = parts.boxes;
    this.baseView = parts.baseView;
    this.interruptBits = parts.interruptBits;
    this.resetsAfterCast = parts.resetsAfterCast;
    this.hasResets = parts.resetsAfterCast.includes(1);
    this.#procs = parts.procs;
    this.#random = parts.random;
    this.#streams = parts.streams;
    this.#resetExt = parts.resetExt;
    this.delayed = new DelayedProcs<G>(this, parts.slots);
    this.pool = createPool({
      create: () => new Cast<G>(this, this.#pending ?? missing('a caster'), parts.createExt()),
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

  /** Takes a cast from the pool for a caster, held once by the caller. */
  acquire(caster: G['bearer']): Cast<G> {
    this.#pending = caster;

    const handle = this.pool.acquire();
    const cast = this.pool.get(handle) ?? missing('a pooled cast');

    this.#pending = undefined;
    cast.cast = toCastHandle(handle);
    cast.caster = caster;
    cast.origin.self = caster;
    cast.holds = 1;

    return cast;
  }

  /** The cast record behind a handle, live (running, or ended and still held), or `undefined` when stale. */
  castOf(handle: CastHandle): Cast<G> | undefined {
    return this.pool.get(toHandle<Cast<G>>(handle));
  }

  /** Lets go of one hold on a cast; an ended cast nothing holds goes back to the pool. */
  unhold(cast: Cast<G>): void {
    cast.holds -= 1;

    if (cast.holds <= 0 && cast.stage === 'ended') {
      this.#free(cast);
    }
  }

  readonly applyFor = (cast: Cast<G>, proc: Proc<G>): ProcOutcome => {
    const outer = this.current;

    this.current = cast;

    try {
      return this.procs.apply(proc, cast.origin);
    } finally {
      this.current = outer;
    }
  };

  readonly randomFor = (cast: Cast<G>, stream: G['stream'] | undefined): Random =>
    stream === undefined
      ? (this.#random ?? missing('the spells’ own random stream'))
      : (this.#streams ?? missing('named streams'))(stream, cast.key());

  readonly retarget = (cast: Cast<G>): unknown => this.registry.hooks.target[cast.spell]?.(cast, cast.input);

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

  /** Takes the reusable handle list of the next nesting level; give it back with `giveHandles`. */
  takeHandles(): CastHandle[] {
    const handles = (this.#handles[this.#handleDepth] ??= []);

    this.#handleDepth += 1;

    return handles;
  }

  /** Gives back the handle list `takeHandles` handed out last, clearing its first `used` entries. */
  giveHandles(handles: CastHandle[], used: number): void {
    for (let i = 0; i < used; i++) {
      handles[i] = NO_CAST;
    }

    this.#handleDepth -= 1;
  }

  /**
   * Runs what a hook returned for its cast, as the cast's procs (credited to it, `current` while they run): a list, or
   * the reusable `list` it was handed (returned, or left filled with nothing returned). Returns how many went off.
   */
  run(cast: Cast<G>, result: ProcReturn<G>, list: ProcList<G>): number {
    const procs = Array.isArray(result) ? result : list.items;

    if (procs.length === 0) {
      return 0;
    }

    const outer = this.current;

    this.current = cast;

    try {
      return this.procs.run(procs, cast.origin);
    } finally {
      this.current = outer;
    }
  }

  /** Fires a cue a spell's cue hook returned, on the caster and credited to it; nothing for `undefined`. */
  fire(cast: Cast<G>, spec: CueSpec | undefined): void {
    if (spec !== undefined) {
      this.fireOn(cast.caster, cast.casterId, spec);
    }
  }

  /** Fires a cue on a caster, credited to its entity id; returns the event, for a key to be set on it. */
  fireOn(caster: G['bearer'], casterId: number, spec: CueSpec): CueEvent {
    const place = this.#place;
    const point = (this.host.positionOf ?? missing('host.positionOf'))(caster);

    place.owner = casterId;
    place.entity = casterId;
    place.x = point.x;
    place.z = point.z;

    return fireCue(this.cues ?? missing('a cue buffer'), spec, place);
  }

  /** Raises one of the spell events about a cast, when something hears it; an end carries the cast's outcome. */
  raise(kind: keyof Omit<SpellEvents<G>, 'bus'>, cast: Cast<G>, hit?: SpellHit<G>): void {
    const events = this.events;
    const event = events?.[kind];

    if (events === undefined || event === undefined || !events.bus.hears(event)) {
      return;
    }

    const payload: SpellEvent<G> = events.bus.payload(event);

    payload.cast = cast;
    payload.hit = hit;
    payload.outcome = kind === 'end' ? cast.outcome : undefined;
    events.bus.raise(event, payload);
  }

  /**
   * Puts on (or takes off) the aura a spell's caster holds while it casts, credited to the caster; nothing
   * when another running cast of the same caster holds the same aura, so overlapping casts share one.
   */
  holdCastAura(cast: Cast<G>, isOn: boolean): void {
    const aura = this.castAuras[cast.spell];

    if (aura === undefined || this.#isHeldElsewhere(cast, aura)) {
      return;
    }

    if (!isOn) {
      this.auras.remove(cast.caster, aura);

      return;
    }

    const application = (this.#application ??= new CastAuraApplication(aura));

    application.aura = aura;
    application.source = cast.casterId;
    this.auras.apply(cast.caster, application);
  }

  /** Whether another running cast of the same caster holds the same cast aura. */
  #isHeldElsewhere(cast: Cast<G>, aura: AuraId): boolean {
    const record = recordOf(cast.caster);

    for (let i = 0; i < record.count; i++) {
      const other = this.castOf(record.handles[i] ?? NO_CAST);

      if (other !== undefined && other !== cast && this.castAuras[other.spell] === aura) {
        return true;
      }
    }

    return false;
  }

  /** Puts an ended cast's record back: its stats box, the game's fields, its references. */
  #free(cast: Cast<G>): void {
    if (cast.box !== undefined) {
      this.boxes.give(cast.spell, cast.box);
      cast.box = undefined;
    }

    this.#resetExt?.(cast.ext);
    cast.input = undefined;
    cast.target = undefined;
    cast.state = undefined;
    cast.stats = NO_STATS;
    cast.scaled = NO_SCALED;
    this.pool.release(toHandle<Cast<G>>(cast.cast));
  }
}
