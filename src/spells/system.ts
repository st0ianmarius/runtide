import type { AuraId, AuraSystem } from '../auras/index.ts';
import type { Random } from '../core/index.ts';
import type { CueBuffer } from '../cues/index.ts';
import type { StatId } from '../modifiers/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import { planOf } from './cast-plan.ts';
import { CasterRecord, type CasterState, recordOf } from './caster.ts';
import type { SpellRegistry } from './define-spells.ts';
import { type SpellClock, SpellEngine } from './engine.ts';
import type { SpellEvents } from './events.ts';
import { type CastHandle, NO_CAST } from './ids.ts';
import {
  type CastOptions,
  type CastReport,
  type CastRequest,
  hitCast,
  NO_OPTIONS,
  Report,
  startCast,
} from './runner.ts';
import type { AnySpellDef, SpellContext, SpellHit } from './spell-def.ts';
import type { SpellHost } from './spell-host.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';
import { baseView, StatsBoxes } from './stats-box.ts';

/** What a spell system is built from (§I.5): the game's spells, the systems they run on, the clock and the host. */
export interface SpellSystemBase<G extends SpellTypes> {
  /** The game's spells (`defineSpells`). */
  readonly registry: SpellRegistry<G>;

  /** The aura system cast auras land through (the proc system's). */
  readonly auras: AuraSystem<G>;

  /**
   * The proc system every hook's procs run through, or a function returning it: the proc registry lists the spell
   * system's own kinds, so a game builds the spell system first and hands it the proc system late.
   */
  readonly procs: ProcSystem<G> | (() => ProcSystem<G>);

  /** The fixed-step clock every stage counts on (a core `SimClock`). */
  readonly clock: SpellClock;

  /** The host: the framework services and the game's own. */
  readonly host: SpellHost<G> & G['host'];

  /** The spells' own random stream, which `ctx.random()` without a name draws from. */
  readonly random?: Random;

  /**
   * The host's named streams (a `StreamTable`'s `random`), which `ctx.random(name)` draws from: a keyed name draws
   * keyed rolls over the cast's key (§I.5: `(startTick, casterId, spellId, targetId, index)`).
   */
  readonly streams?: (stream: G['stream'], key: readonly number[]) => Random;

  /** The bus and event kinds spell events are raised on. */
  readonly events?: SpellEvents<G>;

  /** The buffer spell cues fire into; required when any spell has cues. */
  readonly cues?: CueBuffer;

  /** Clears the game's fields of a cast as its slot goes back to the pool. */
  readonly resetExt?: (ext: G['castExt']) => void;
}

/**
 * The options of a spell system: its base, and `createExt`, which makes the game's fields for each pooled cast. It is
 * required exactly when the game's `castExt` type does not admit `undefined`.
 */
export type SpellSystemOptions<G extends SpellTypes> = SpellSystemBase<G> &
  (undefined extends G['castExt']
    ? {
        /** Makes the game's fields of a pooled cast; they stay `undefined` when absent. */
        readonly createExt?: () => G['castExt'];
      }
    : {
        /** Makes the game's fields of a pooled cast. */
        readonly createExt: () => G['castExt'];
      });

/**
 * A spell system (§I.6): the runner over one game's spells, for any caster. It starts casts in the cast order, runs
 * their hooks' procs credited to them, raises spell events and fires spell cues, and holds each spell's cast aura on
 * its caster while it casts.
 */
export interface SpellSystem<G extends SpellTypes> {
  /** The game's spells. */
  readonly registry: SpellRegistry<G>;

  /** How many cast records the pool has made, and how many are live: a steady state makes no new ones. */
  readonly pool: {
    /** Records ever made. */
    readonly created: number;

    /** Records live now (running, or ended and still held). */
    readonly live: number;
  };

  /** A new caster state, for a unit that casts (`SpellCaster.casts`). */
  readonly createCasterState: () => CasterState;

  /**
   * Starts a cast (§II.3.1): the gates (the host's `canAct`, the activation kind's), the stats, `canCast`, the target,
   * then `begin`, and the release at once for a spell with no windup. Returns the system's reused report.
   */
  readonly cast: (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>) => CastReport;

  /** A delivery of a cast caught units: `onHit` with all of them, its cue and event; how many procs went off. */
  readonly hit: (cast: CastHandle, hit: SpellHit<G>) => number;

  /** A live cast's context (running, or ended and still held by its delayed procs); `undefined` when stale. */
  readonly get: (cast: CastHandle) => SpellContext<G> | undefined;

  /** Whether a cast is still in a stage (windup, channel or recover). */
  readonly isRunning: (cast: CastHandle) => boolean;

  /** Whether a caster runs any cast, or a cast of one spell. */
  readonly isCasting: (caster: G['bearer'], spell?: SpellId) => boolean;

  /**
   * Writes a caster's running casts into `out` from index 0, in the order they started, and returns how many. `out`
   * keeps its storage; entries past the count are left as they were.
   */
  readonly castsOf: (caster: G['bearer'], out: CastHandle[]) => number;

  /**
   * A spell's share of an outgoing multiplier stat (§II.3.13: `SpellDef.scaling`), or `undefined` for a share of 1:
   * what the damage host's `shareOf` answers with (`shareOf: spells.shareOf`).
   */
  readonly shareOf: (spell: SpellId, stat: StatId) => number | undefined;
}

/** Whether `undefined` is the game's `castExt`: true exactly when the options could leave `createExt` out. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isNoExt = <G extends SpellTypes>(value: undefined): value is undefined & G['castExt'] => value === undefined;

/** The ext factory: the game's, or `undefined` for a game whose `castExt` admits it. */
const extFactory = <G extends SpellTypes>(options: SpellSystemOptions<G>): (() => G['castExt']) => {
  const create: (() => G['castExt']) | undefined = options.createExt;

  return (
    create ??
    ((): G['castExt'] => {
      const none = undefined;

      if (!isNoExt<G>(none)) {
        throw new TypeError('This spell system needs createExt.');
      }

      return none;
    })
  );
};

/** Resolves a spell's cast aura against the aura registry at load: a live aura that lasts while the cast runs. */
const castAuraOf = <G extends SpellTypes>(
  auras: AuraSystem<G>,
  def: AnySpellDef<G> | undefined,
  name: string,
): AuraId | undefined => {
  const aura = def?.castAura;

  if (aura === undefined) {
    return undefined;
  }

  const ids: Readonly<Record<string, AuraId | undefined>> = auras.registry.id;
  const id = typeof aura === 'string' ? ids[aura] : aura;

  if (id === undefined || id < 0 || id >= auras.registry.size || auras.registry.isRetired(id)) {
    throw new RangeError(`Spell ${name}: its cast aura ${aura} is not a live aura.`);
  }

  if (auras.registry.get(id).duration !== 'infinite') {
    throw new RangeError(`Spell ${name}: its cast aura lasts while the cast runs, so its duration is 'infinite'.`);
  }

  return id;
};

/** Checks at load that spells with cues have a buffer to fire into and a host that places them. */
const checkCues = <G extends SpellTypes>(options: SpellSystemOptions<G>): void => {
  const { registry } = options;
  const cued = registry.ids.find((id) => registry.defs[id]?.cues !== undefined);

  if (cued !== undefined && (options.cues === undefined || options.host.positionOf === undefined)) {
    throw new RangeError(`Spell ${registry.name(cued)} has cues, so the system needs cues and host.positionOf.`);
  }
};

/** Builds the engine over the options, every table resolved. */
const engineOf = <G extends SpellTypes>(options: SpellSystemOptions<G>): SpellEngine<G> => {
  const { registry } = options;

  checkCues(options);

  return new SpellEngine<G>({
    registry,
    auras: options.auras,
    procs: options.procs,
    clock: options.clock,
    host: options.host,
    random: options.random,
    streams: options.streams,
    events: options.events,
    cues: options.cues,
    plans: registry.defs.map((def) => (def === undefined ? undefined : planOf(def, registry.activations))),
    castAuras: registry.defs.map((def, id) => castAuraOf(options.auras, def, registry.names[id] ?? '')),
    boxes: new StatsBoxes(registry.compiled),
    baseView: baseView(registry.stats),
    createExt: extFactory(options),
    resetExt: options.resetExt,
  });
};

/** The request a system reuses for every cast. */
class MutableRequest<G extends SpellTypes> implements CastRequest<G> {
  caster: G['bearer'];
  spell: SpellId;
  options: CastOptions<G> = NO_OPTIONS;

  constructor(caster: G['bearer'], spell: SpellId) {
    this.caster = caster;
    this.spell = spell;
  }
}

/** A spell system: a class for fast properties, its functions arrow fields so they work detached. */
class Spells<G extends SpellTypes> implements SpellSystem<G> {
  readonly registry: SpellRegistry<G>;
  readonly pool: SpellSystem<G>['pool'];
  readonly #engine: SpellEngine<G>;
  readonly #report = new Report();
  #request: MutableRequest<G> | undefined = undefined;

  constructor(engine: SpellEngine<G>) {
    this.#engine = engine;
    this.registry = engine.registry;

    this.pool = {
      get created() {
        return engine.pool.created;
      },

      get live() {
        return engine.pool.live;
      },
    };
  }

  readonly createCasterState = (): CasterState => new CasterRecord(this.registry.autoIds.length);

  readonly cast = (caster: G['bearer'], spell: SpellId, options?: CastOptions<G>): CastReport => {
    // One request per system: the cast order reads it before any hook runs, so a nested cast may rewrite it.
    const request = (this.#request ??= new MutableRequest<G>(caster, spell));

    request.caster = caster;
    request.spell = spell;
    request.options = options ?? NO_OPTIONS;

    return startCast(this.#engine, request, this.#report);
  };

  readonly hit = (cast: CastHandle, hit: SpellHit<G>): number => hitCast(this.#engine, cast, hit);

  readonly get = (cast: CastHandle): SpellContext<G> | undefined => this.#engine.castOf(cast);

  readonly isRunning = (cast: CastHandle): boolean => {
    const stage = this.#engine.castOf(cast)?.stage;

    return stage !== undefined && stage !== 'ended';
  };

  readonly isCasting = (caster: G['bearer'], spell?: SpellId): boolean => {
    const record = recordOf(caster);

    if (spell === undefined) {
      return record.count > 0;
    }

    for (let i = 0; i < record.count; i++) {
      if (this.#engine.castOf(record.handles[i] ?? NO_CAST)?.spell === spell) {
        return true;
      }
    }

    return false;
  };

  readonly castsOf = (caster: G['bearer'], out: CastHandle[]): number => {
    const record = recordOf(caster);

    for (let i = 0; i < record.count; i++) {
      out[i] = record.handles[i] ?? NO_CAST;
    }

    return record.count;
  };

  readonly shareOf = (spell: SpellId, stat: StatId): number | undefined => {
    const share = this.registry.shares[spell]?.[stat];

    return share === undefined || Number.isNaN(share) ? undefined : share;
  };
}

/**
 * Creates the spell system over a game's spells (§I.5): `createSpellSystem({ registry: SPELLS, auras, procs: () =>
 * procs, clock, host })`. Every cast aura is resolved and every plan built at load; nothing is looked up by name
 * afterwards.
 */
export const createSpellSystem = <G extends SpellTypes>(options: SpellSystemOptions<G>): SpellSystem<G> =>
  Object.freeze(new Spells(engineOf(options)));
