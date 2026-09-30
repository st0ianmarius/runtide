// Hot path: every proc list goes through here, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { ActiveAura, AuraContext, AuraSystem } from '../auras/index.ts';
import type { Random } from '../core/index.ts';
import type { CueBuffer } from '../cues/index.ts';
import { createApplier, missing } from './apply.ts';
import { type FrameRunner, type FrameShared, ProcFrame } from './frame.ts';
import type { Proc } from './proc-data.ts';
import type { ProcResolver } from './proc-kind.ts';
import {
  PROC_SKIPPED,
  type ProcBus,
  type ProcContext,
  type ProcHost,
  type ProcOrigin,
  type ProcOutcome,
  type ProcTypes
} from './proc-types.ts';
import type { ProcRegistry } from './registry.ts';
import { createResolver, prepareProcs, type ResolverParts } from './resolver.ts';

/** What a proc system is built from: the game's kinds, the aura system, its host and its streams. */
export interface ProcSystemOptions<G extends ProcTypes> {
  /** The game's proc kinds (`createProcRegistry`). */
  readonly kinds: ProcRegistry<G>;

  /** The aura system aura procs land through. */
  readonly auras: AuraSystem<G>;

  /** The host: the framework services (`party`, `idOf`, `grant`) and the game's own (`{}` for none). */
  readonly host: ProcHost<G> & G['host'];

  /**
   * The procs' own random stream, which `chance` rolls on and nothing else draws from (a salted sequential stream,
   * `stream(seed, salt)`, or a keyed source), so adding a proc never shifts another system's rolls.
   */
  readonly random?: Random;

  /**
   * A game's own chance rule, in place of one draw on `random` below `chance`: a keyed roll over the
   * context, a proc-per-minute rate. Called only for `0 < chance < 1`.
   */
  readonly rollChance?: (chance: number, ctx: ProcContext<G>) => boolean;

  /** The host's named streams, which a `pickOne` names (the stream table). */
  readonly streams?: (stream: G['stream'], ctx: ProcContext<G>) => Random;

  /** The game's resource names, which `grant` procs name; a resource's id is its position here. */
  readonly resources?: readonly G['resource'][];

  /** The bus `event` procs raise on. */
  readonly bus?: ProcBus;

  /** The buffer `cue` procs fire into (the tick's cue events). */
  readonly cues?: CueBuffer;

  /** The most proc lists nested at once (a list set off by a list set off by …); deeper ones drop. 4 by default. */
  readonly maxDepth?: number;
}

/**
 * A proc system: the runner over one game's proc kinds. A list applies in order, each proc seeing what the ones
 * before it did; a proc aimed at a unit the list already killed does nothing; an always-proc rolls
 * nothing, and a `chance` rolls on the procs' own stream; lists nest up to the depth cap.
 */
export interface ProcSystem<G extends ProcTypes> {
  /** The proc kinds. */
  readonly kinds: ProcRegistry<G>;

  /** The aura system. */
  readonly auras: AuraSystem<G>;

  /** The host. */
  readonly host: ProcHost<G> & G['host'];

  /** How many lists are running right now: 0 outside any. */
  readonly depth: number;

  /** The depth cap. */
  readonly maxDepth: number;

  /** How many lists the depth cap has dropped so far. */
  readonly dropped: number;

  /**
   * Starts a fresh nesting: the depth cap counts from the lists running now, as for lists run from outside any. What a
   * death sets off nests from it afresh (a damage system's `procs`), so a chain of kills through procs is capped by the
   * damage system's `maxKillChain`, not by this cap. Returns the base to hand back to `restoreBase`.
   */
  readonly rebase: () => number;

  /** Ends a fresh nesting, handing back the base `rebase` returned. */
  readonly restoreBase: (base: number) => void;

  /** Every `run` hatch seen (prepared or run) and how many times it ran, in the order first seen. */
  readonly runs: ReadonlyMap<string, number>;

  /** Resolves names when a proc applies (and for explanations). */
  readonly resolver: ProcResolver<G>;

  /**
   * Runs a list for an origin; returns how many of its procs went off (were not `skipped`). An entry left `undefined`
   * is passed over, so a reused list filled by index up to a count (a spell hook's `out`) runs as it is.
   */
  readonly run: (procs: readonly (Proc<G> | undefined)[], origin: ProcOrigin<G>) => number;

  /** Applies one proc for an origin, as a list of one, and returns what it did. */
  readonly apply: (proc: Proc<G>, origin: ProcOrigin<G>) => ProcOutcome;

  /**
   * Runs what an aura hook returned (`AuraHost.run`): for the bearer, credited to the aura's source. Wire it as the
   * aura system's host: `run: (procs, ctx) => procSystem.runAura(procs, ctx)`.
   */
  readonly runAura: (procs: readonly Proc<G>[], ctx: AuraContext<G>) => void;

  /**
   * Prepares a static list at load: checks every chance is in (0, 1] and every kind and name is known, and resolves
   * names to ids, so the list applies with no lookups. Throws a `RangeError` naming `what`.
   */
  readonly prepare: (procs: readonly Proc<G>[], what: string) => readonly Proc<G>[];
}

/** A reusable origin, for the runs the system starts itself. */
interface MutableOrigin<G extends ProcTypes> {
  /** Who the procs act for. */
  self: G['bearer'];

  /** The default target. */
  target: G['bearer'];

  /** The event unit. */
  eventUnit: G['bearer'] | undefined;

  /** The event's other unit. */
  other: G['bearer'] | undefined;

  /** The credited source. */
  source: number;

  /** The aura. */
  aura: ActiveAura<G> | undefined;
}

/** The mutable state of one system's runner. */
interface RunnerState<G extends ProcTypes> {
  /** The frames, one per nesting level. */
  readonly frames: ProcFrame<G>[];

  /** Lists running now. */
  depth: number;

  /** Lists dropped by the cap. */
  dropped: number;

  /** The depth the cap counts from (`rebase`). */
  base: number;

  /** Hatch run counts. */
  readonly runs: Map<string, number>;

  /** The origin `runAura` reuses. */
  auraOrigin: MutableOrigin<G> | undefined;
}

/** The runner a system and its frames share. */
interface Runner<G extends ProcTypes> extends FrameRunner<G> {
  /** Runs a list. */
  readonly list: (procs: readonly (Proc<G> | undefined)[], origin: ProcOrigin<G>) => number;

  /** Applies one proc as a list of one. */
  readonly one: (proc: Proc<G>, origin: ProcOrigin<G>) => ProcOutcome;
}

/** The frames of one system, one per nesting level, and its depth cap. */
const createStack = <G extends ProcTypes>(
  options: ProcSystemOptions<G>,
  state: RunnerState<G>,
  shared: () => FrameShared<G>
) => {
  const maxDepth = options.maxDepth ?? 4;

  return {
    isTooDeep: (): boolean => {
      if (state.depth - state.base < maxDepth) {
        return false;
      }

      state.dropped += 1;

      return true;
    },

    take: (origin: ProcOrigin<G>): ProcFrame<G> => {
      const frame = state.frames[state.depth] ?? new ProcFrame<G>(shared(), state.depth + 1, origin);

      state.frames[state.depth] = frame;
      state.depth += 1;
      frame.reset(origin);

      return frame;
    }
  };
};

/** Builds the runner: lists applied proc by proc in a frame of their own, under the depth cap. */
const createRunner = <G extends ProcTypes>(
  options: ProcSystemOptions<G>,
  state: RunnerState<G>,
  resolve: ProcResolver<G>
): Runner<G> => {
  const applyIn = createApplier(options);

  const { isTooDeep, take } = createStack(options, state, () => ({
    auras: options.auras,
    host: options.host,
    bus: options.bus,
    cues: options.cues,
    runner,
    resolve
  }));

  const list = (procs: readonly (Proc<G> | undefined)[], origin: ProcOrigin<G>): number => {
    if (procs.length === 0 || isTooDeep()) {
      return 0;
    }

    const frame = take(origin);
    let went = 0;

    try {
      for (let i = 0; i < procs.length; i++) {
        const proc = procs[i];

        if (proc !== undefined && applyIn(frame, proc).status !== 'skipped') {
          went += 1;
        }
      }
    } finally {
      state.depth -= 1;
    }

    return went;
  };

  const runner: Runner<G> = {
    applyIn,
    list,

    one: (proc, origin) => {
      if (isTooDeep()) {
        return PROC_SKIPPED;
      }

      const frame = take(origin);

      try {
        return applyIn(frame, proc);
      } finally {
        state.depth -= 1;
      }
    },

    deeper: (frame, procs) => list(procs, frame),

    randomFor: (frame, stream) =>
      stream === undefined
        ? (options.random ?? missing('a random stream'))
        : (options.streams ?? missing('named streams'))(stream, frame),

    countRun: (hatch) => {
      state.runs.set(hatch, (state.runs.get(hatch) ?? 0) + 1);
    }
  };

  return runner;
};

/** The parts every resolver of a system reads. */
const partsOf = <G extends ProcTypes>(options: ProcSystemOptions<G>, state: RunnerState<G>): ResolverParts<G> => ({
  auras: options.auras,
  kinds: options.kinds,
  resources: options.resources ?? [],
  cues: options.cues?.registry,

  noteHatch: (name: string) => {
    if (!state.runs.has(name)) {
      state.runs.set(name, 0);
    }
  }
});

/** Checks the depth cap. */
const checkDepth = (maxDepth: number | undefined): void => {
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
    throw new RangeError(`A proc system's maxDepth must be a whole number from 1; got ${maxDepth}.`);
  }
};

/** A proc system: a class for fast properties, its functions arrow fields so they work detached. */
class Procs<G extends ProcTypes> implements ProcSystem<G> {
  readonly kinds: ProcRegistry<G>;
  readonly auras: AuraSystem<G>;
  readonly host: ProcHost<G> & G['host'];
  readonly maxDepth: number;
  readonly runs: ReadonlyMap<string, number>;
  readonly resolver: ProcResolver<G>;
  readonly run: (procs: readonly (Proc<G> | undefined)[], origin: ProcOrigin<G>) => number;
  readonly apply: (proc: Proc<G>, origin: ProcOrigin<G>) => ProcOutcome;
  readonly #state: RunnerState<G>;
  readonly #parts: ResolverParts<G>;

  constructor(options: ProcSystemOptions<G>) {
    const state: RunnerState<G> = {
      frames: [],
      depth: 0,
      dropped: 0,
      base: 0,
      runs: new Map(),
      auraOrigin: undefined
    };

    const parts = partsOf(options, state);
    const resolver = createResolver(parts, undefined);
    const runner = createRunner(options, state, resolver);

    this.kinds = options.kinds;
    this.auras = options.auras;
    this.host = options.host;
    this.maxDepth = options.maxDepth ?? 4;
    this.runs = state.runs;
    this.resolver = resolver;
    this.run = runner.list;
    this.apply = runner.one;
    this.#state = state;
    this.#parts = parts;
  }

  get depth(): number {
    return this.#state.depth;
  }

  get dropped(): number {
    return this.#state.dropped;
  }

  readonly rebase = (): number => {
    const { base } = this.#state;

    this.#state.base = this.#state.depth;

    return base;
  };

  readonly restoreBase = (base: number): void => {
    this.#state.base = base;
  };

  readonly runAura = (procs: readonly Proc<G>[], ctx: AuraContext<G>): void => {
    const origin = (this.#state.auraOrigin ??= {
      self: ctx.bearer,
      target: ctx.bearer,
      eventUnit: undefined,
      other: ctx.other,
      source: ctx.aura.source,
      aura: ctx.aura
    });

    origin.self = ctx.bearer;
    origin.target = ctx.bearer;
    origin.other = ctx.other;
    origin.source = ctx.aura.source;
    origin.aura = ctx.aura;
    this.run(procs, origin);
  };

  readonly prepare = (procs: readonly Proc<G>[], what: string): readonly Proc<G>[] =>
    prepareProcs(this.#parts, procs, what);
}

/**
 * Creates the proc system over a game's kinds and aura system: `createProcSystem({ kinds: PROCS, auras, host,
 * random: stream(seed, PROC_SALT) })`. The aura system hands it what its hooks return through `runAura`.
 */
export const createProcSystem = <G extends ProcTypes>(options: ProcSystemOptions<G>): ProcSystem<G> => {
  checkDepth(options.maxDepth);

  return Object.freeze(new Procs(options));
};
