import { type ActiveAura, type AuraId, type AuraSystem, NO_SOURCE } from '../auras/index.ts';
import type { Random } from '../core/index.ts';
import type { CueBuffer } from '../cues/index.ts';
import type { CueFiring } from './cue-kind.ts';
import type { Proc } from './proc-data.ts';
import type { ProcResolver } from './proc-kind.ts';
import type { ProcBus, ProcContext, ProcHost, ProcOrigin, ProcOutcome, ProcStatus, ProcTypes } from './proc-types.ts';

/** An aura application a frame reuses for every `applyAura` it lands (a field set to `undefined` counts as absent). */
export interface ReusedApplication<G extends ProcTypes> {
  /** The aura. */
  aura: AuraId;

  /** Its length. */
  duration: number | undefined;

  /** Its stacks. */
  stacks: number | undefined;

  /** Its value. */
  value: number | undefined;

  /** Its source. */
  source: number | undefined;

  /** Its stacking override. */
  stacking: 'refresh' | 'extend' | 'stack' | 'highest' | undefined;

  /** Its payload. */
  payload: G['payload'] | undefined;
}

/** What a frame calls back into: the system that owns it. */
export interface FrameRunner<G extends ProcTypes> {
  /** Applies one proc within a frame's list. */
  readonly applyIn: (frame: ProcFrame<G>, proc: Proc<G>) => ProcOutcome;

  /** Runs a list one level deeper for a frame's origin. */
  readonly deeper: (frame: ProcFrame<G>, procs: readonly Proc<G>[]) => number;

  /** A random source for a frame. */
  readonly randomFor: (frame: ProcFrame<G>, stream: G['stream'] | undefined) => Random;

  /** Counts one run of a hatch. */
  readonly countRun: (hatch: string) => void;
}

/** What every frame of one system shares. */
export interface FrameShared<G extends ProcTypes> {
  /** The aura system. */
  readonly auras: AuraSystem<G>;

  /** The host. */
  readonly host: ProcHost<G> & G['host'];

  /** The bus `event` procs raise on. */
  readonly bus: ProcBus | undefined;

  /** The buffer `cue` procs fire into. */
  readonly cues: CueBuffer | undefined;

  /** The system. */
  readonly runner: FrameRunner<G>;

  /** Resolves names procs carry. */
  readonly resolve: ProcResolver<G>;
}

/**
 * One running proc list's context, pooled per nesting level: the origin's fields, the units the list killed, and a
 * reused aura application (made on the first `applyAura`). Its functions are arrow fields, so they work detached.
 */
export class ProcFrame<G extends ProcTypes> implements ProcContext<G> {
  self: G['bearer'];
  target: G['bearer'];
  eventUnit: G['bearer'] | undefined = undefined;
  source = NO_SOURCE;
  aura: ActiveAura<G> | undefined = undefined;
  readonly depth: number;
  readonly auras: AuraSystem<G>;
  readonly host: ProcHost<G> & G['host'];
  readonly bus: ProcBus | undefined;
  readonly cues: CueBuffer | undefined;
  readonly resolve: ProcResolver<G>;

  /** The units the list killed, valid up to `killedCount`; never shrunk, so a reused frame allocates nothing. */
  readonly killed: (G['bearer'] | undefined)[] = [];

  /** How many units the list killed. */
  killedCount = 0;

  application: ReusedApplication<G> | undefined = undefined;

  /** The spec and place a `cue` proc fires with, made on the first one. */
  firing: CueFiring | undefined = undefined;

  readonly #runner: FrameRunner<G>;

  constructor(shared: FrameShared<G>, depth: number, origin: ProcOrigin<G>) {
    this.depth = depth;
    this.auras = shared.auras;
    this.host = shared.host;
    this.bus = shared.bus;
    this.cues = shared.cues;
    this.resolve = shared.resolve;
    this.#runner = shared.runner;
    this.self = origin.self;
    this.target = origin.self;
  }

  readonly apply = (proc: Proc<G>): ProcOutcome => this.#runner.applyIn(this, proc);

  readonly run = (procs: readonly Proc<G>[]): number => this.#runner.deeper(this, procs);

  readonly random = (stream?: G['stream']): Random => this.#runner.randomFor(this, stream);

  /** Takes an origin's fields and forgets the last list's kills. */
  reset(origin: ProcOrigin<G>): void {
    this.self = origin.self;
    this.target = origin.target ?? origin.self;
    this.eventUnit = origin.eventUnit;
    this.source = origin.source ?? this.host.idOf?.(origin.self) ?? NO_SOURCE;
    this.aura = origin.aura;

    // Cleared by index, never shrunk: shrinking an array to 0 drops its storage, and lists run all the time.
    for (let i = 0; i < this.killedCount; i++) {
      this.killed[i] = undefined;
    }

    this.killedCount = 0;
  }

  /** Whether the list killed a unit. */
  hasKilled(unit: G['bearer']): boolean {
    for (let i = 0; i < this.killedCount; i++) {
      if (this.killed[i] === unit) {
        return true;
      }
    }

    return false;
  }

  /** Notes that the list killed a unit. */
  noteKill(unit: G['bearer']): void {
    this.killed[this.killedCount] = unit;
    this.killedCount += 1;
  }

  /** Counts one run of a hatch. */
  countRun(hatch: string): void {
    this.#runner.countRun(hatch);
  }

  /**
   * Writes an outcome into the frame's reused one and returns it: what a proc with follow-ups reports, read before
   * they ran (a follow-up may reuse the outcome object the proc returned). The caller reads it before the next apply.
   */
  settle(status: ProcStatus, parts: { readonly amount: number; readonly hasKilled: boolean }): ProcOutcome {
    const settled = this.#settled;

    settled.status = status;
    settled.amount = parts.amount;
    settled.hasKilled = parts.hasKilled;

    return settled;
  }

  readonly #settled: SettledOutcome = { status: 'landed', amount: 0, hasKilled: false };
}

/** The mutable outcome a frame settles. */
interface SettledOutcome {
  /** What became of the proc. */
  status: ProcStatus;

  /** How much it did. */
  amount: number;

  /** Whether it killed its target. */
  hasKilled: boolean;
}

/** Whether a context is a system's frame. */
const isFrame = <G extends ProcTypes>(ctx: ProcContext<G>): ctx is ProcFrame<G> => ctx instanceof ProcFrame;

/** The frame behind a context a proc kind was handed, refusing one made elsewhere. */
export const frameOf = <G extends ProcTypes>(ctx: ProcContext<G>): ProcFrame<G> => {
  if (!isFrame(ctx)) {
    throw new TypeError('A proc context must come from a proc system.');
  }

  return ctx;
};
