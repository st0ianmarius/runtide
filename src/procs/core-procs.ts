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
  type ProcTypes,
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
    target: G['bearer'] | undefined,
  ): ProcOutcome | undefined;

  /** The proc with its names resolved. */
  prepare?<G extends ProcTypes>(this: void, proc: CoreProcMap<G>[Kind], resolve: ProcResolver<G>): CoreProcMap<G>[Kind];

  /** Its numbers and nested procs, as data. */
  explain?<G extends ProcTypes>(this: void, proc: CoreProcMap<G>[Kind], resolve: ProcResolver<G>): ProcDetail<G>;
}

/** The numbers of a record that are present, for an explanation. */
const numbersOf = (values: Readonly<Record<string, number | undefined>>): Readonly<Record<string, number>> =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined));

/** Applies each proc of a list in the context's own list, in order. */
const applyEach = <G extends ProcTypes>(ctx: ProcContext<G>, procs: readonly Proc<G>[] | undefined): void => {
  for (const proc of procs ?? []) {
    ctx.apply(proc);
  }
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
      payload: undefined,
    });

    application.aura = aura;
    application.duration = proc.duration;
    application.stacks = proc.stacks;
    application.value = proc.value;
    application.source = ctx.source;
    application.stacking = proc.stacking;
    application.payload = proc.payload;

    return ctx.auras.apply(target, application).applied ? PROC_LANDED : PROC_REFUSED;
  },

  prepare: (proc, resolve) => ({ ...proc, aura: resolve.aura(proc.aura) }),

  explain: (proc, resolve) => ({
    values: numbersOf({
      aura: resolve.aura(proc.aura),
      duration: proc.duration,
      stacks: proc.stacks,
      value: proc.value,
    }),
  }),
};

/** Removes every instance of an aura; `skipped` when there was none. */
const removeAuraKind: CoreProcKind<'removeAura'> = {
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) =>
    target !== undefined && ctx.auras.remove(target, frameOf(ctx).resolve.aura(proc.aura)) ? PROC_LANDED : PROC_SKIPPED,

  prepare: (proc, resolve) => ({ ...proc, aura: resolve.aura(proc.aura) }),
  explain: (proc, resolve) => ({ values: { aura: resolve.aura(proc.aura) } }),
};

/** The outcomes of a cleanse that removed a few auras, made once so a cleanse allocates nothing. */
const CLEANSED: readonly ProcOutcome[] = Array.from({ length: 17 }, (_unused, amount) =>
  procOutcome('landed', { amount }),
);

/** A cleanse; its amount is how many auras went, `skipped` when none did. */
const removeByTagKind: CoreProcKind<'removeByTag'> = {
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) => {
    const removed = target === undefined ? 0 : ctx.auras.removeByTag(target, frameOf(ctx).resolve.tag(proc.tag));

    return removed === 0 ? PROC_SKIPPED : (CLEANSED[removed] ?? procOutcome('landed', { amount: removed }));
  },

  prepare: (proc, resolve) => ({ ...proc, tag: resolve.tag(proc.tag) }),
  explain: (proc, resolve) => ({ values: { tag: resolve.tag(proc.tag) } }),
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

  prepare: (proc, resolve) => ({ ...proc, resource: resolve.resource(proc.resource) }),
  explain: (proc, resolve) => ({ values: { resource: resolve.resource(proc.resource), amount: proc.amount } }),
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

  explain: (proc) => ({ values: { event: proc.event } }),
};

/** Applies its procs in order, in the same list. */
const groupKind: CoreProcKind<'group'> = {
  apply: (proc, ctx) => {
    applyEach(ctx, proc.procs);

    return PROC_LANDED;
  },

  prepare: (proc, resolve) => ({ ...proc, procs: resolve.procs(proc.procs) }),
  explain: (proc) => ({ procs: proc.procs }),
};

/** Applies the procs its function decides now, in the same list. */
const andThenKind: CoreProcKind<'andThen'> = {
  apply: (proc, ctx) => {
    applyEach(ctx, proc.fn(ctx));

    return PROC_LANDED;
  },
};

/** Draws one candidate now, then applies the procs decided for it, in the same list; `skipped` with none. */
const pickOneKind: CoreProcKind<'pickOne'> = {
  apply: (proc, ctx) => {
    const candidates = proc.from(ctx);

    if (candidates.length === 0) {
      return PROC_SKIPPED;
    }

    applyEach(ctx, proc.onPick(ctx, pick(ctx.random(proc.stream), candidates)));

    return PROC_LANDED;
  },
};

/** Runs the game's code, counted under its hatch name. */
const runKind: CoreProcKind<'run'> = {
  apply: (proc, ctx) => {
    frameOf(ctx).countRun(proc.hatch);
    proc.fn(ctx);

    return PROC_LANDED;
  },

  prepare: (proc, resolve) => {
    resolve.hatch(proc.hatch);

    return proc;
  },
};

/**
 * The framework's proc kinds (§I.6, §II.3.6), the ones that need no host beyond the aura system and the framework's own
 * services: `applyAura`, `removeAura`, `removeByTag`, `grant`, `event`, the control kinds `group`, `andThen`, `pickOne`
 * and `run`, and `cue` (appended last, so the kinds before it keep their ids). A game registers them with its own:
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
});
