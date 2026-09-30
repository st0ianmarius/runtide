import type { EventKind } from '../core/index.ts';
import { recordOf } from '../core/records.ts';
import type { ActiveAura, AuraContext } from './active-aura.ts';
import type { ApplyResult, AuraApplication, AuraHost } from './application.ts';
import type { AuraEvent, AuraEventBus } from './aura-event.ts';
import type { AuraId, AuraTagId, AuraTypes } from './aura-types.ts';
import type { CollectedHook } from './collect.ts';
import { type AuraClock, type AuraModifiers, compileAuras } from './compile.ts';
import type { AuraRegistry } from './define-auras.ts';
import type { Dispel } from './dispel.ts';
import { AuraEngine } from './engine.ts';
import { type AuraExplanation, explainIn } from './explain.ts';
import { operationsOf, queriesOf } from './operations.ts';
import type { AuraSeed } from './seed.ts';
import { AuraSet, type AuraState } from './state.ts';
import type { AuraTagTable } from './tags.ts';
import { tickAuras } from './tick.ts';
import type { AuraView, ViewOptions } from './view.ts';

/** What an aura system is built from: the game's registries and its host. */
export interface AuraSystemBase<G extends AuraTypes> {
  /** The game's auras (`defineAuras`). */
  readonly registry: AuraRegistry<G>;

  /** The game's aura tags (`defineAuraTags`). */
  readonly tags: AuraTagTable<G['tag']>;

  /**
   * The clocks auras count on, by name, each with its fixed step (a core `SimClock` is one). The
   * first is every aura's default. Each bearer counts its own steps on each (`tick`).
   */
  readonly clocks: Readonly<Record<G['clock'], AuraClock>>;

  /** The modifier system aura modifiers fold in, when any aura has modifiers. */
  readonly modifiers?: AuraModifiers<G>;

  /** The modifier source aura modifiers fold at unless an aura names its own. */
  readonly fold?: G['source'];

  /** The bearer states `removedOn` may name, at most 32. */
  readonly states?: readonly G['state'][];

  /** The host: proc runner, stats, application policy, tag edges. */
  readonly host?: AuraHost<G>;

  /** The bus and event kind lifecycle events are raised on (registered with `createAuraEvent`). */
  readonly events?: {
    /** The bus. */
    readonly bus: AuraEventBus;

    /** The kind its lifecycle events (`applied`, `removed`, …: an aura changing) are raised as. */
    readonly changed: EventKind<AuraEvent<G>>;
  };

  /** Clears the game's fields of an aura as its slot goes back to the pool. */
  readonly resetExt?: (ext: G['ext']) => void;
}

/**
 * The options of an aura system: its base, and `createExt`, which makes the game's fields for each pooled aura. It
 * is required exactly when the game's `ext` type does not admit `undefined`.
 */
export type AuraSystemOptions<G extends AuraTypes> = AuraSystemBase<G> &
  (undefined extends G['ext']
    ? {
        /** Makes the game's fields of a pooled aura; they stay `undefined` when absent. */
        readonly createExt?: () => G['ext'];
      }
    : {
        /** Makes the game's fields of a pooled aura. */
        readonly createExt: () => G['ext'];
      });

/** How a bearer's aura state is made. */
export interface StateOptions {
  /** Whether it runs no hooks and raises no events (a preview or a prediction copy); false when absent. */
  readonly isSilent?: boolean;
}

/**
 * An aura system: the machinery over one game's aura registry, for any bearer. Every operation takes the bearer
 * (anything holding a state made by `createState`), runs the aura's rules, then its hooks and events.
 */
export interface AuraSystem<G extends AuraTypes> {
  /** The game's auras. */
  readonly registry: AuraRegistry<G>;

  /** The game's aura tags. */
  readonly tags: AuraTagTable<G['tag']>;

  /** The id of every clock, by name. */
  readonly clocks: Readonly<Record<G['clock'], number>>;

  /** How many aura slots the pool has made, and how many are live: a steady state makes no new ones. */
  readonly pool: {
    /** Slots ever made. */
    readonly created: number;

    /** Slots live now. */
    readonly live: number;
  };

  /** A new, empty aura state for one bearer; a silent one runs no hooks and raises no events. */
  readonly createState: (options?: StateOptions) => AuraState;

  /** Applies an aura (by id, or with an application's options); see `ApplyResult`. */
  readonly apply: (bearer: G['bearer'], aura: AuraId | AuraApplication<G>) => ApplyResult;

  /** Removes every instance of an aura; true when there was one. */
  readonly remove: (bearer: G['bearer'], aura: AuraId) => boolean;

  /** Removes every aura granting a tag (a cleanse or dispel); how many went. */
  readonly removeByTag: (bearer: G['bearer'], tag: AuraTagId) => number;

  /**
   * Dispels: up to a limit of the auras granting a tag that its filter keeps, in list order, with the dispeller as
   * their remover (`onRemoved`'s `ctx.remover`, the aura event's `remover`). Returns how many went.
   */
  readonly dispel: (bearer: G['bearer'], spec: Dispel<G>) => number;

  /** Sets every instance's clock again, to `seconds` or the aura's own length; true when there was one. */
  readonly refresh: (bearer: G['bearer'], aura: AuraId, seconds?: number) => boolean;

  /** Spends stacks, instance by instance; refuses (spending nothing) when fewer are held. */
  readonly spendStacks: (bearer: G['bearer'], aura: AuraId, count: number) => boolean;

  /**
   * Spends from an aura's value: from every instance of it in order (an aura id), or from one instance alone (an active
   * aura, as an absorb hook's own); returns the amount spent.
   */
  readonly spendValue: (bearer: G['bearer'], aura: AuraId | ActiveAura, amount: number) => number;

  /**
   * The bearer enters a state (a death, a despawn, the game's going down): every aura on it hears it (`onState`), then
   * every aura whose `removedOn` names it is removed; how many went.
   */
  readonly enterState: (bearer: G['bearer'], state: G['state']) => number;

  /** Whether the system declares a bearer state by this name (a unit system enters its lifecycle's by name). */
  readonly hasState: (state: string) => state is G['state'];

  /** A source is gone: every aura bound to it is removed; how many went. */
  readonly sourceGone: (bearer: G['bearer'], source: number) => number;

  /**
   * The bearer is gone for good (a despawned unit): every aura still on it comes off, raising nothing, and its slot goes
   * back to the pool; how many went. Enter its last state first, so its auras hear it.
   */
  readonly release: (bearer: G['bearer']) => number;

  /** Steps the bearer's clock once: beats, then expiries. */
  readonly tick: (bearer: G['bearer'], clock: G['clock']) => void;

  /** Whether the bearer has an aura. */
  readonly has: (bearer: G['bearer'], aura: AuraId) => boolean;

  /** The bearer's auras in list order (registry order, then application order), typed: its state's `list`. */
  readonly list: (bearer: G['bearer']) => readonly ActiveAura<G>[];

  /** The first instance of an aura on the bearer. */
  readonly find: (bearer: G['bearer'], aura: AuraId) => ActiveAura<G> | undefined;

  /** The stacks of an aura summed over its instances; 0 when it is not held. */
  readonly stacks: (bearer: G['bearer'], aura: AuraId) => number;

  /** The seconds left on an aura (its longest instance); 0 when it is not held. */
  readonly remaining: (bearer: G['bearer'], aura: AuraId) => number;

  /** The seconds left on one instance. */
  readonly remainingOf: (bearer: G['bearer'], aura: ActiveAura) => number;

  /** Whether any aura on the bearer grants a tag. */
  readonly hasTag: (bearer: G['bearer'], tag: AuraTagId) => boolean;

  /** An aura's own length for one application on a bearer; throws for an aura with none. */
  readonly lengthOf: (aura: AuraId, bearer: G['bearer']) => number;

  /**
   * Writes the bearer's auras that have a pipeline hook into `out` from index 0, in list order, and returns how many.
   * `out` keeps its storage (it is never shrunk, so a reused array allocates nothing); entries past the count that an
   * earlier call wrote are cleared to `undefined`, so it keeps no references. A walk over them whose hooks may remove
   * and apply auras runs between `hold` and `unhold`, so a removed one stays itself (`isActive` false) and a later
   * application never takes its slot mid-walk.
   */
  readonly collect: (bearer: G['bearer'], hook: CollectedHook<G>, out: (ActiveAura<G> | undefined)[]) => number;

  /** Keeps removed auras' slots out of the pool until the matching `unhold`. Calls nest. */
  readonly hold: () => void;

  /** Lets go of a `hold`; the outermost gives back the slots of the auras removed meanwhile. */
  readonly unhold: () => void;

  /** A context for calling one aura's hook from a pipeline; a new object, which the caller may keep for the call. */
  readonly context: (bearer: G['bearer'], aura: ActiveAura<G>) => AuraContext<G>;

  /**
   * The reused hook context of the next nesting level, filled for one aura and the event's other unit, if any: what a
   * pipeline calls a hook with when it must not allocate. Give it back with `giveContext` once the hook and the procs
   * it returned are done.
   */
  readonly takeContext: (bearer: G['bearer'], aura: ActiveAura<G>, other?: G['bearer']) => AuraContext<G>;

  /** Gives back the context `takeContext` handed out last. */
  readonly giveContext: () => void;

  /**
   * Writes the bearer's auras as views for the wire into `out` from index 0, reusing its records; returns how many.
   */
  readonly view: (bearer: G['bearer'], out: AuraView[], options?: ViewOptions) => number;

  /**
   * Multiplies the time left on every finite aura granting a tag by a factor (a cooldown scaled down),
   * keeping each one's duration; one left at 0 runs out on the next tick. Raises nothing; returns how many changed.
   */
  readonly scaleTimeLeft: (bearer: G['bearer'], tag: AuraTagId, factor: number) => number;

  /** Caps the time left on every finite aura granting a tag at some seconds; returns how many changed. */
  readonly clampTimeLeft: (bearer: G['bearer'], tag: AuraTagId, seconds: number) => number;

  /** Whether an aura is `predicted`: rebuilt on a prediction mirror from the wire. */
  readonly isPredicted: (aura: AuraId) => boolean;

  /**
   * Seeds a prediction mirror's `predicted` auras from the server's views of the bearer: they replace the
   * mirror's, each ending as far past the mirror's count of its clock as it ended past the server's, and the mirror's
   * serial count becomes the server's. Only a silent state may be seeded. Returns how many it seeded.
   */
  readonly seed: (bearer: G['bearer'], seed: AuraSeed) => number;

  /**
   * Whether a mirror's predicted auras already are what `seed` would make of a seed, reading only: a client seeds and
   * replays only when they differ.
   */
  readonly matchesSeed: (bearer: G['bearer'], seed: AuraSeed) => boolean;
}

/** Whether `undefined` is the game's `ext`: true exactly when the options could leave `createExt` out. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isNoExt = <G extends AuraTypes>(value: undefined): value is undefined & G['ext'] => value === undefined;

/** The ext factory: the game's, or `undefined` for a game whose `ext` admits it. */
const extFactory = <G extends AuraTypes>(options: AuraSystemOptions<G>): (() => G['ext']) => {
  const create: (() => G['ext']) | undefined = options.createExt;

  return (
    create ??
    ((): G['ext'] => {
      const none = undefined;

      if (!isNoExt<G>(none)) {
        throw new TypeError('This aura system needs createExt.');
      }

      return none;
    })
  );
};

/** Each system's explainer, for `explainAura`. */
const EXPLAINERS = new WeakMap<object, (aura: AuraId, stacks: number) => AuraExplanation>();

/**
 * An aura of a system's registry explained as data, at `stacks` stacks (1 by default): its rules, tags,
 * modifiers and beat, with the numbers the simulation uses, for the client to phrase.
 */
export const explainAura = <G extends AuraTypes>(auras: AuraSystem<G>, aura: AuraId, stacks = 1): AuraExplanation => {
  const explain = EXPLAINERS.get(auras);

  if (explain === undefined) {
    throw new TypeError('explainAura needs a system made by createAuraSystem.');
  }

  return explain(aura, stacks);
};

/**
 * Creates the aura system over a game's registries: `createAuraSystem({ registry: AURAS, tags: AURA_TAGS,
 * clocks: { world }, modifiers, fold: 'auras', host })`. Every name is resolved and every modifier list compiled and
 * shared at load; nothing is looked up by name afterwards.
 */
export const createAuraSystem = <G extends AuraTypes>(options: AuraSystemOptions<G>): AuraSystem<G> => {
  const { registry } = options;
  const tables = compileAuras(options);
  const host = options.host ?? {};

  const engine = new AuraEngine<G>({
    registry,
    tables,
    host,
    events: options.events,
    createExt: extFactory(options),
    resetExt: options.resetExt
  });

  const clockNames = Object.keys(options.clocks).filter((key): key is G['clock'] => Object.hasOwn(options.clocks, key));

  const clockIds = recordOf(clockNames, (name) => clockNames.indexOf(name));

  const system: AuraSystem<G> = {
    registry,
    tags: options.tags,
    clocks: clockIds,

    pool: {
      get created() {
        return engine.pool.created;
      },

      get live() {
        return engine.pool.live;
      }
    },

    createState: (stateOptions = {}) => new AuraSet<G>(tables.clockNames.length, stateOptions.isSilent === true),

    tick: (bearer, clock) => {
      tickAuras(engine, bearer, clockIds[clock] ?? 0);
    },

    ...operationsOf(engine),
    ...queriesOf(engine)
  };

  EXPLAINERS.set(system, (aura, stacks) => explainIn(engine, aura, stacks));

  return Object.freeze(system);
};
