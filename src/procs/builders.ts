import type { AuraId, AuraTagId } from '../auras/index.ts';
import type { EventKind } from '../core/index.ts';
import type { CueId } from '../cues/index.ts';
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
  TimeLeftProc,
} from './proc-data.ts';
import type { ProcContext, ProcTarget, ProcTypes } from './proc-types.ts';

/** The options every builder takes: the proc's odds. */
export interface ChanceOption {
  /** The odds it goes off; always when absent. */
  readonly chance?: number;
}

/** The options of a builder for a kind that acts on a unit: its odds and where it lands. */
export interface TargetOptions<G extends ProcTypes> extends ChanceOption {
  /** Where it lands; the list's target when absent. */
  readonly to?: ProcTarget<G>;
}

/** An `applyAura` proc: `applyAura('burning', { to: 'eventUnit', duration: 4 })`. */
export const applyAura = <G extends ProcTypes = ProcTypes>(
  aura: G['auraName'] | AuraId,
  options: Omit<ApplyAuraProc<G>, 'kind' | 'aura'> = {},
): ApplyAuraProc<G> => ({ ...options, kind: 'applyAura', aura });

/** A `removeAura` proc. */
export const removeAura = <G extends ProcTypes = ProcTypes>(
  aura: G['auraName'] | AuraId,
  options: TargetOptions<G> = {},
): RemoveAuraProc<G> => ({ ...options, kind: 'removeAura', aura });

/** A `removeByTag` proc: a cleanse. */
export const removeByTag = <G extends ProcTypes = ProcTypes>(
  tag: G['tag'] | AuraTagId,
  options: TargetOptions<G> = {},
): RemoveByTagProc<G> => ({ ...options, kind: 'removeByTag', tag });

/**
 * A `timeLeft` proc: `timeLeft('cooldown.skill', { factor: 0.5 })` halves what is left of a cooldown,
 * `timeLeft('cooldown', { max: 2 })` leaves none of them more than 2 s.
 */
export const timeLeft = <G extends ProcTypes = ProcTypes>(
  tag: G['tag'] | AuraTagId,
  options: TargetOptions<G> & { readonly factor?: number; readonly max?: number } = {},
): TimeLeftProc<G> => ({ ...options, kind: 'timeLeft', tag });

/** A `grant` proc: `grant('gold', 5)`. */
export const grant = <G extends ProcTypes = ProcTypes>(
  resource: G['resource'] | number,
  amount: number,
  options: TargetOptions<G> = {},
): GrantProc<G> => ({ ...options, kind: 'grant', resource, amount });

/** An `event` proc: raises `event` with the payload `fill` writes, typed by the event kind. */
export const raise = <Payload, G extends ProcTypes = ProcTypes>(
  event: EventKind<Payload>,
  fill: (payload: Payload, ctx: ProcContext<G>) => void,
  options: ChanceOption = {},
): EventProc<G> => ({ ...options, kind: 'event', event, fill });

/** A `cue` proc: `cue('flash', { to: 'eventUnit', params: { size: 2 } })`. */
export const cue = <G extends ProcTypes = ProcTypes>(
  id: G['cueName'] | CueId,
  options: Omit<CueProc<G>, 'kind' | 'cue'> = {},
): CueProc<G> => ({ ...options, kind: 'cue', cue: id });

/** A `group`: several procs behind one chance, all or nothing. */
export const group = <G extends ProcTypes = ProcTypes>(
  procs: readonly Proc<G>[],
  options: ChanceOption = {},
): GroupProc<G> => ({ ...options, kind: 'group', procs });

/** An `andThen`: procs decided when it applies, after the ones before it (the plan's `then`). */
export const andThen = <G extends ProcTypes = ProcTypes>(
  fn: (ctx: ProcContext<G>) => readonly Proc<G>[] | undefined,
  options: ChanceOption = {},
): AndThenProc<G> => ({ ...options, kind: 'andThen', fn });

/** A `pickOne`: one of `from`'s units, drawn when it applies, then `onPick`'s procs for it. */
export const pickOne = <G extends ProcTypes = ProcTypes>(
  from: (ctx: ProcContext<G>) => readonly G['bearer'][],
  onPick: (ctx: ProcContext<G>, picked: G['bearer']) => readonly Proc<G>[] | undefined,
  options: ChanceOption & {
    /** The stream it draws from; the procs' own when absent. */
    readonly stream?: G['stream'];
  } = {},
): PickOneProc<G> => ({ ...options, kind: 'pickOne', from, onPick });

/** A `run`: the game's own code, named for the escape report (`run('coil.detect', fn)`). */
export const run = <G extends ProcTypes = ProcTypes>(
  hatch: string,
  fn: (ctx: ProcContext<G>) => void,
  options: ChanceOption = {},
): RunProc<G> => ({ ...options, kind: 'run', hatch, fn });
