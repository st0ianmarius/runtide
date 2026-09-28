// Hot path (§I.4.2, §I.5.4): every proc list goes through here, so the loops are indexed.
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
  type ProcTypes,
} from './proc-types.ts';
import type { ProcRegistry } from './registry.ts';
import { createResolver, prepareProcs, type ResolverParts } from './resolver.ts';

/** What a proc system is built from (§I.5): the game's kinds, the aura system, its host and its streams. */
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
   * A game's own chance rule (§I.5.6 hatch 2), in place of one draw on `random` below `chance`: a keyed roll over the
   * context, a proc-per-minute rate. Called only for `0 < chance < 1`.
   */
  readonly rollChance?: (chance: number, ctx: ProcContext<G>) => boolean;

  /** The host's named streams, which a `pickOne` names (the stream table, §II.6.1 rule 3). */
  readonly streams?: (stream: G['stream'], ctx: ProcContext<G>) => Random;

  /** The game's resource names, which `grant` procs name; a resource's id is its position here. */
  readonly resources?: readonly G['resource'][];

  /** The bus `event` procs raise on. */
  readonly bus?: ProcBus;

  /** The buffer `cue` procs fire into (the tick's cue events, §II.3.9). */
  readonly cues?: CueBuffer;

  /** The most proc lists nested at once (a list set off by a list set off by …); deeper ones drop. 4 by default. */
  readonly maxDepth?: number;
}

/**
 * A proc system (§I.6): the runner over one game's proc kinds. A list applies in order, each proc seeing what the ones
 * before it did (§II.6.1 rule 2); a proc aimed at a unit the list already killed does nothing; an always-proc rolls
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

  /** Every `run` hatch seen (prepared or run) and how many times it ran, in the order first seen. */
  readonly runs: ReadonlyMap<string, number>;

  /** Resolves names when a proc applies (and for explanations). */
  readonly resolver: ProcResolver<G>;

  /** Runs a list for an origin; returns how many of its procs went off (were not `skipped`). */
  readonly run: (procs: readonly Proc<G>[], origin: ProcOrigin<G>) => number;

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

  /** Hatch run counts. */
  readonly runs: Map<string, number>;

  /** The origin `runAura` reuses. */
  auraOrigin: MutableOrigin<G> | undefined;
}

/** The runner a system and its frames share. */
interface Runner<G extends ProcTypes> extends FrameRunner<G> {
  /** Runs a list. */
  readonly list: (procs: readonly Proc<G>[], origin: ProcOrigin<G>) => number;

  /** Applies one proc as a list of one. */
  readonly one: (proc: Proc<G>, origin: ProcOrigin<G>) => ProcOutcome;
}

/** The frames of one system, one per nesting level, and its depth cap. */
const createStack = <G extends ProcTypes>(
  options: ProcSystemOptions<G>,
  state: RunnerState<G>,
  shared: () => FrameShared<G>,
) => {
  const maxDepth = options.maxDepth ?? 4;

  return {
    isTooDeep: (): boolean => {
      if (state.depth < maxDepth) {
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
    },
  };
};

/** Builds the runner: lists applied proc by proc in a frame of their own, under the depth cap. */
const createRunner = <G extends ProcTypes>(
  options: ProcSystemOptions<G>,
  state: RunnerState<G>,
  resolve: ProcResolver<G>,
): Runner<G> => {
  const applyIn = createApplier(options);

  const { isTooDeep, take } = createStack(options, state, () => ({
    auras: options.auras,
    host: options.host,
    bus: options.bus,
    cues: options.cues,
    runner,
    resolve,
  }));

  const list = (procs: readonly Proc<G>[], origin: ProcOrigin<G>): number => {
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
    },
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
  },
});

/** Checks the depth cap. */
const checkDepth = (maxDepth: number | undefined): void => {
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
    throw new RangeError(`A proc system's maxDepth must be a whole number from 1; got ${maxDepth}.`);
  }
};

/**
 * Creates the proc system over a game's kinds and aura system (§I.5): `createProcSystem({ kinds: PROCS, auras, host,
 * random: stream(seed, PROC_SALT) })`. The aura system hands it what its hooks return through `runAura`.
 */
export const createProcSystem = <G extends ProcTypes>(options: ProcSystemOptions<G>): ProcSystem<G> => {
  checkDepth(options.maxDepth);

  const state: RunnerState<G> = { frames: [], depth: 0, dropped: 0, runs: new Map(), auraOrigin: undefined };
  const parts = partsOf(options, state);
  const resolver = createResolver(parts, undefined);
  const runner = createRunner(options, state, resolver);

  return Object.freeze({
    kinds: options.kinds,
    auras: options.auras,
    host: options.host,

    get depth() {
      return state.depth;
    },

    maxDepth: options.maxDepth ?? 4,

    get dropped() {
      return state.dropped;
    },

    runs: state.runs,
    resolver,
    run: runner.list,

    apply: runner.one,

    runAura: (procs: readonly Proc<G>[], ctx: AuraContext<G>) => {
      const origin = (state.auraOrigin ??= {
        self: ctx.bearer,
        target: ctx.bearer,
        eventUnit: undefined,
        source: ctx.aura.source,
        aura: ctx.aura,
      });

      origin.self = ctx.bearer;
      origin.target = ctx.bearer;
      origin.source = ctx.aura.source;
      origin.aura = ctx.aura;
      runner.list(procs, origin);
    },

    prepare: (procs: readonly Proc<G>[], what: string) => prepareProcs(parts, procs, what),
  });
};
