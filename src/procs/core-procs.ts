import type { AuraId } from '../auras/index.ts';
import { pick } from '../core/index.ts';
import { CUE_KIND } from './cue-kind.ts';
import { frameOf } from './frame.ts';
import type {
  AndThenProc,
  ApplyAuraProc,
  CueProc,
  EventProc,
  GrantProc,
  GroupProc,
  PickOneProc,
  Proc,
  RemoveAuraProc,
  RemoveByTagProc,
  RunProc,
  TimeLeftProc
} from './proc-data.ts';
import type { ProcDetail, ProcResolver } from './proc-kind.ts';
import {
  PROC_LANDED,
  PROC_REFUSED,
  PROC_SKIPPED,
  type ProcContext,
  procOutcome,
  type ProcOutcome,
  type ProcTarget,
  type ProcTypes
} from './proc-types.ts';

/** The framework's proc kinds' data, by name. */
interface CoreProcMap<G extends ProcTypes> {
  /** Lands an aura. */
  readonly applyAura: ApplyAuraProc<G>;

  /** Removes an aura. */
  readonly removeAura: RemoveAuraProc<G>;

  /** Removes every aura carrying a tag. */
  readonly removeByTag: RemoveByTagProc<G>;

  /** Hands out a resource. */
  readonly grant: GrantProc<G>;

  /** Raises an event. */
  readonly event: EventProc<G>;

  /** Several procs behind one chance. */
  readonly group: GroupProc<G>;

  /** Procs decided after the ones before. */
  readonly andThen: AndThenProc<G>;

  /** A random pick at apply time. */
  readonly pickOne: PickOneProc<G>;

  /** The game's own code. */
  readonly run: RunProc<G>;

  /** Fires a cue. */
  readonly cue: CueProc<G>;

  /** Scales or caps the time left on the auras carrying a tag. */
  readonly timeLeft: TimeLeftProc<G>;
}

/** The name of one of the framework's proc kinds. */
export type CoreProcName = keyof CoreProcMap<ProcTypes>;

/**
 * One of the framework's proc kinds: a `ProcKindDef` whose functions are generic over the game's types, so the same
 * `CORE_PROCS` object serves every game's registry.
 */
export interface CoreProcKind<Kind extends CoreProcName> {
  /** Where a proc lands, for a kind that acts on a unit. */
  targetOf?<G extends ProcTypes>(this: void, proc: CoreProcMap<G>[Kind]): ProcTarget<G> | undefined;

  /** Applies one proc to its resolved target. */
  apply<G extends ProcTypes>(
    this: void,
    proc: CoreProcMap<G>[Kind],
    ctx: ProcContext<G>,
    target: G['bearer'] | undefined
  ): ProcOutcome | undefined;

  /** The proc with its names resolved. */
  prepare?<G extends ProcTypes>(this: void, proc: CoreProcMap<G>[Kind], resolve: ProcResolver<G>): CoreProcMap<G>[Kind];

  /** Its numbers and nested procs, as data. */
  explain?<G extends ProcTypes>(this: void, proc: CoreProcMap<G>[Kind], resolve: ProcResolver<G>): ProcDetail<G>;
}

/** The numbers of a record that are present, for an explanation. */
const numbersOf = (values: Readonly<Record<string, number | undefined>>): Readonly<Record<string, number>> =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined));

/**
 * Applies each proc of a list in the context's own list, in order; returns how many were not `skipped`, so a control
 * kind inside which nothing happened reports `skipped` too.
 */
const applyEach = <G extends ProcTypes>(ctx: ProcContext<G>, procs: readonly Proc<G>[] | undefined): number => {
  if (procs === undefined) {
    return 0;
  }

  let went = 0;

  // An indexed loop: groups run here, and an iterator over a frozen list allocates.
  // oxlint-disable-next-line typescript/prefer-for-of
  for (let i = 0; i < procs.length; i++) {
    const proc = procs[i];

    if (proc !== undefined && ctx.apply(proc).status !== 'skipped') {
      went += 1;
    }
  }

  return went;
};

/** `landed` when some of a control kind's procs went off, `skipped` when none did. */
const wentOff = (went: number): ProcOutcome => (went === 0 ? PROC_SKIPPED : PROC_LANDED);

/** The built-in stacking rules an application may pick (`independent` is an aura's own, never an application's). */
const STACKING_RULES: ReadonlySet<unknown> = new Set(['refresh', 'extend', 'stack', 'highest']);

/** Throws unless an optional number of a proc is from 0 (not NaN); `Infinity` passes when `infinite` allows it. */
const checkCount = (name: string, value: number | undefined, infinite = false): void => {
  if (value !== undefined && !(value >= 0 && (infinite || Number.isFinite(value)))) {
    throw new RangeError(
      `an applyAura proc's ${name} must be a ${infinite ? '' : 'finite '}number from 0; got ${value}.`
    );
  }
};

/**
 * Checks an `applyAura` at load: its stacking rule a built-in one its aura may take (not on an `independent` aura),
 * its length a number from 0 (`Infinity` for an aura that stays), its stacks a finite one.
 */
const checkApplication = <G extends ProcTypes>(
  proc: ApplyAuraProc<G>,
  aura: AuraId,
  resolve: ProcResolver<G>
): void => {
  const { stacking } = proc;

  if (stacking !== undefined && !STACKING_RULES.has(stacking)) {
    throw new RangeError(
      `unknown stacking rule ${String(stacking)}; an applyAura takes refresh, extend, stack or highest.`
    );
  }

  if (stacking !== undefined && resolve.isIndependent(aura)) {
    throw new RangeError(`an applyAura cannot pick a stacking rule for an independent aura.`);
  }

  checkCount('duration', proc.duration, true);
  checkCount('stacks', proc.stacks);
};

/** Lands an aura through the aura system, with the frame's reused application, credited to the list's source. */
const applyAuraKind: CoreProcKind<'applyAura'> = {
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) => {
    if (target === undefined) {
      return PROC_SKIPPED;
    }

    const frame = frameOf(ctx);
    const aura = frame.resolve.aura(proc.aura);

    const application = (frame.application ??= {
      aura,
      duration: undefined,
      stacks: undefined,
      value: undefined,
      source: undefined,
      stacking: undefined,
      payload: undefined
    });

    application.aura = aura;
    application.duration = proc.durationOf === undefined ? proc.duration : proc.durationOf(ctx);
    application.stacks = proc.stacksOf === undefined ? proc.stacks : proc.stacksOf(ctx);
    application.value = proc.valueFrom === undefined ? proc.value : proc.valueFrom(ctx);
    application.source = ctx.source;
    application.stacking = proc.stacking;
    application.payload = proc.payloadOf === undefined ? proc.payload : proc.payloadOf(ctx);

    return ctx.auras.apply(target, application).applied ? PROC_LANDED : PROC_REFUSED;
  },

  prepare: (proc, resolve) => {
    const aura = resolve.aura(proc.aura);

    checkApplication(proc, aura, resolve);

    return { ...proc, aura };
  },

  explain: (proc, resolve) => ({
    values: numbersOf({
      aura: resolve.aura(proc.aura),
      duration: proc.duration,
      stacks: proc.stacks,
      value: proc.value
    })
  })
};

/** Removes every instance of an aura; `skipped` when there was none. */
const removeAuraKind: CoreProcKind<'removeAura'> = {
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) =>
    target !== undefined && ctx.auras.remove(target, frameOf(ctx).resolve.aura(proc.aura)) ? PROC_LANDED : PROC_SKIPPED,

  prepare: (proc, resolve) => ({ ...proc, aura: resolve.aura(proc.aura) }),
  explain: (proc, resolve) => ({ values: { aura: resolve.aura(proc.aura) } })
};

/** The outcomes of a cleanse that removed a few auras, made once so a cleanse allocates nothing. */
const CLEANSED: readonly ProcOutcome[] = Array.from({ length: 17 }, (_unused, amount) =>
  procOutcome('landed', { amount })
);

/** A cleanse; its amount is how many auras went, `skipped` when none did. */
const removeByTagKind: CoreProcKind<'removeByTag'> = {
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) => {
    const removed = target === undefined ? 0 : ctx.auras.removeByTag(target, frameOf(ctx).resolve.tag(proc.tag));

    return removed === 0 ? PROC_SKIPPED : (CLEANSED[removed] ?? procOutcome('landed', { amount: removed }));
  },

  prepare: (proc, resolve) => ({ ...proc, tag: resolve.tag(proc.tag) }),
  explain: (proc, resolve) => ({ values: { tag: resolve.tag(proc.tag) } })
};

/** Throws unless a time change has a factor or a cap, its factor a finite number from 0 and its cap a number from 0. */
const checkTimeLeft = <G extends ProcTypes>(proc: TimeLeftProc<G>): void => {
  if (proc.factor === undefined && proc.max === undefined) {
    throw new RangeError(`A timeLeft proc takes a factor, a max or both.`);
  }

  if (!(Number.isFinite(proc.factor ?? 1) && (proc.factor ?? 1) >= 0) || !((proc.max ?? 0) >= 0)) {
    throw new RangeError(`A timeLeft proc takes a finite factor from 0 and a max from 0.`);
  }
};

/** A time change on the auras carrying a tag; its amount is how many changed, `skipped` when none did. */
const timeLeftKind: CoreProcKind<'timeLeft'> = {
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) => {
    if (target === undefined) {
      return PROC_SKIPPED;
    }

    const tag = frameOf(ctx).resolve.tag(proc.tag);

    const scaled = proc.factor === undefined ? 0 : ctx.auras.scaleTimeLeft(target, tag, proc.factor);

    const clamped = proc.max === undefined ? 0 : ctx.auras.clampTimeLeft(target, tag, proc.max);
    const changed = Math.max(scaled, clamped);

    return changed === 0 ? PROC_SKIPPED : (CLEANSED[changed] ?? procOutcome('landed', { amount: changed }));
  },

  prepare: (proc, resolve) => {
    checkTimeLeft(proc);

    return { ...proc, tag: resolve.tag(proc.tag) };
  },

  explain: (proc, resolve) => ({
    values: {
      tag: resolve.tag(proc.tag),
      ...(proc.factor === undefined ? {} : { factor: proc.factor }),
      ...(proc.max === undefined ? {} : { max: proc.max })
    }
  })
};

/** Hands out a resource through `host.grant`. */
const grantKind: CoreProcKind<'grant'> = {
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) => {
    if (ctx.host.grant === undefined) {
      throw new TypeError('A grant proc needs host.grant.');
    }

    if (target === undefined) {
      return PROC_SKIPPED;
    }

    ctx.host.grant(target, frameOf(ctx).resolve.resource(proc.resource), proc.amount);

    return PROC_LANDED;
  },

  prepare: (proc, resolve) => {
    resolve.need('grant');

    if (!Number.isFinite(proc.amount)) {
      throw new RangeError(`a grant proc's amount must be a finite number; got ${proc.amount}.`);
    }

    return { ...proc, resource: resolve.resource(proc.resource) };
  },

  explain: (proc, resolve) => ({
    values: { resource: resolve.resource(proc.resource), amount: proc.amount }
  })
};

/** Fills and raises an event on the procs' bus; `skipped`, filling nothing, when nothing hears it. */
const eventKind: CoreProcKind<'event'> = {
  apply: (proc, ctx) => {
    const { bus } = ctx;

    if (bus === undefined) {
      throw new TypeError('An event proc needs the proc system to have a bus.');
    }

    if (!bus.hears(proc.event)) {
      return PROC_SKIPPED;
    }

    const payload = bus.payload(proc.event);

    proc.fill(payload, ctx);
    bus.raise(proc.event, payload);

    return PROC_LANDED;
  },

  prepare: (proc, resolve) => {
    resolve.need('bus');

    return proc;
  },

  explain: (proc) => ({ values: { event: proc.event } })
};

/** Applies its procs in order, in the same list; `skipped` when none of them went off. */
const groupKind: CoreProcKind<'group'> = {
  apply: (proc, ctx) => wentOff(applyEach(ctx, proc.procs)),

  prepare: (proc, resolve) => ({ ...proc, procs: resolve.procs(proc.procs) }),
  explain: (proc) => ({ procs: proc.procs })
};

/**
 * Applies the procs its function decides now, in the same list; `skipped` when none of them went off (what the
 * function applied itself through `ctx.apply` does not count).
 */
const andThenKind: CoreProcKind<'andThen'> = {
  apply: (proc, ctx) => wentOff(applyEach(ctx, proc.fn(ctx)))
};

/**
 * Draws one candidate now, then applies the procs decided for it, in the same list; `skipped` with no candidate or
 * when none of its procs went off.
 */
const pickOneKind: CoreProcKind<'pickOne'> = {
  apply: (proc, ctx) => {
    const candidates = proc.from(ctx);

    if (candidates.length === 0) {
      return PROC_SKIPPED;
    }

    return wentOff(applyEach(ctx, proc.onPick(ctx, pick(ctx.random(proc.stream), candidates))));
  }
};

/** Runs the game's code, counted under its hatch name: opaque, so always `landed`. */
const runKind: CoreProcKind<'run'> = {
  apply: (proc, ctx) => {
    frameOf(ctx).countRun(proc.hatch);
    proc.fn(ctx);

    return PROC_LANDED;
  },

  prepare: (proc, resolve) => {
    resolve.hatch(proc.hatch);

    return proc;
  }
};

/**
 * The framework's proc kinds, the ones that need no host beyond the aura system and the framework's own
 * services: `applyAura`, `removeAura`, `removeByTag`, `grant`, `event`, the control kinds `group`, `andThen`, `pickOne`
 * and `run`, then `cue` and `timeLeft` (appended, so the kinds before them keep their ids). A game registers them with its own:
 * `createProcRegistry({ ...CORE_PROCS, ...GAME_PROCS })`.
 */
export const CORE_PROCS: { readonly [Kind in CoreProcName]: CoreProcKind<Kind> } = Object.freeze({
  applyAura: applyAuraKind,
  removeAura: removeAuraKind,
  removeByTag: removeByTagKind,
  grant: grantKind,
  event: eventKind,
  group: groupKind,
  andThen: andThenKind,
  pickOne: pickOneKind,
  run: runKind,
  cue: CUE_KIND,
  timeLeft: timeLeftKind
});
