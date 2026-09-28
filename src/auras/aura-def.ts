import type { Modifier } from '../modifiers/index.ts';
import type { AuraContext } from './active-aura.ts';
import type { AuraApplication } from './application.ts';
import type { AuraTypes } from './aura-types.ts';
import type { AuraDamageHooks } from './damage-hooks.ts';

/**
 * A built-in rule for what a re-application does to an aura already on the bearer:
 *
 * - `refresh`: the clock restarts at the new length (shorter or longer); stacks stay.
 * - `extend`: the new length is added to what is left.
 * - `stack`: one more stack (or the application's count), up to `maxStacks`, and the clock restarts.
 * - `highest`: the clock becomes the longer of what is left and the new length; a shorter one changes nothing.
 * - `keep`: the clock and stacks stay as they are (only the value merges): a top-up.
 * - `independent`: every application is its own instance with its own clock, `maxStacks` of them at most (at the
 *   cap the one with least time left makes way, the first of equals).
 */
export type AuraStacking = 'refresh' | 'extend' | 'stack' | 'highest' | 'keep' | 'independent';

/** What a re-application brings, as a stacking rule sees it. */
export interface IncomingAura {
  /** The length of the new application, in seconds. */
  readonly seconds: number;

  /** The stacks it adds, at least 1. */
  readonly stacks: number;

  /** What is left on the instance already there, in seconds. */
  readonly remaining: number;

  /** The aura's most stacks. */
  readonly maxStacks: number;
}

/** What a stacking rule does to the instance already there. */
export interface Restack {
  /** Sets the clock to this many seconds (and the duration with it); the clock stays when absent. */
  readonly seconds?: number;

  /** Sets the stacks (kept within 1 and `maxStacks`); they stay when absent. */
  readonly stacks?: number;
}

/**
 * A game's own stacking rule: given the instance already there (`ctx.aura`) and the incoming application, what
 * changes; `undefined` changes nothing (and so raises nothing, unless the value merge changes the value).
 */
export type AuraStackingRule<G extends AuraTypes> = (
  ctx: AuraContext<G>,
  incoming: IncomingAura,
) => Restack | undefined;

/**
 * How an application's value merges into the value already there, independently of how the clocks stack: `max`
 * keeps the larger, `add` sums them, `replace` takes the new one.
 */
export type AuraMerge = 'max' | 'add' | 'replace';

/** A game's own value merge: the value after a re-application. */
export type AuraMergeRule = (current: number, incoming: number) => number;

/** What happened to an aura on its bearer, as hooks and events are told. */
export type AuraChange = 'applied' | 'refreshed' | 'expired' | 'removed' | 'bearerDeath';

/** A lifecycle hook: procs credited to the aura's source, or `undefined` for none. */
export type AuraHook<G extends AuraTypes> = (ctx: AuraContext<G>) => readonly G['proc'][] | undefined;

/**
 * A beat on a clock of its own while the aura lasts (§II.6 A3): damage or healing over time, a sweep, a pulse. Beats
 * of one tick fire before that tick's expiries, so a 12 s aura beating every 3 s beats four times, the last on the
 * tick it runs out. A refresh keeps the beat.
 */
export interface AuraPeriodic<G extends AuraTypes> {
  /**
   * Seconds between beats, the first one `every` after the application; read at every beat when a function (a
   * period from live stats), which must then return more than 0. `0` beats on every tick of its clock, with the
   * tick's step as the beat's weight.
   */
  readonly every: number | ((ctx: AuraContext<G>) => number);

  /** The clock the beat counts on; the aura's own clock when absent. */
  readonly clock?: G['clock'];

  /** Whether a due beat fires; a skipped beat still counts (a regeneration paused by a wound). */
  readonly when?: (ctx: AuraContext<G>) => boolean;

  /** The beat: procs credited to the aura's source. `weight` is 1, or the tick's step for an every-tick beat. */
  readonly onBeat: (ctx: AuraContext<G>, weight: number) => readonly G['proc'][] | undefined;
}

/**
 * A clock rescale on the aura's own edges (§II.6 A13): the aura's own multiplier on `stat` (its `mul` modifiers on
 * it, at its stacks) rescales the bearer's pending activation clocks, which the host owns. On `applied` and
 * `refreshed` the clocks are divided by it, on `expired` and `removed` multiplied back.
 */
export interface AuraRescale<G extends AuraTypes> {
  /** The stat whose own multiplier is the factor. */
  readonly stat: G['stat'];

  /** The edges that rescale. */
  readonly on: readonly Exclude<AuraChange, 'bearerDeath'>[];

  /** Whether only clocks still pending (the default) or every clock rescales. */
  readonly clocks?: 'pending' | 'all';

  /** The scope (a spell or tag id) whose clocks rescale; every clock when absent. */
  readonly scope?: number;
}

/**
 * One aura, as data and standalone functions (§I.5.2): a timed state on any bearer. It carries no id; the registry
 * key is its name and its position is its id. Every field is optional.
 */
export interface AuraDef<G extends AuraTypes = AuraTypes> extends AuraDamageHooks<G> {
  /**
   * Seconds each application lasts unless the application says, `'infinite'` (until removed), or a function read
   * at every application. Absent for an aura with no length of its own (a cooldown), which every application must
   * then give.
   */
  readonly duration?: number | 'infinite' | ((bearer: G['bearer']) => number);

  /** The clock its lifetime counts on; the system's first clock when absent. */
  readonly clock?: G['clock'];

  /** What a re-application does: a built-in rule or the game's own; `refresh` when absent. */
  readonly stacking?: AuraStacking | AuraStackingRule<G>;

  /** The most stacks (or `independent` instances) at once, a whole number from 1 to 65,535; 1 when absent. */
  readonly maxStacks?: number;

  /** Whether each source keeps its own instance (WoW's per-caster auras); one shared instance when absent. */
  readonly perSource?: boolean;

  /** Whether a re-application's source takes the credit (`newest`, the default) or the first source keeps it. */
  readonly credit?: 'newest' | 'first';

  /** Stat changes while it is active: an `add` lands `value × stacks`, a `mul` `value ^ stacks` (or linearly). */
  readonly modifiers?: readonly Modifier<G['stat'], G['condition'], G['valueKind']>[];

  /** The modifier source its modifiers fold at; the system's `fold` when absent. */
  readonly fold?: G['source'];

  /** Tags the bearer has while it is active. */
  readonly tags?: readonly G['tag'][];

  /** An immunity: it does not land on a bearer with any of these tags. Tested before `removes`. */
  readonly blockedBy?: readonly G['tag'][];

  /** A cleanse: landing removes every aura carrying one of these tags first, tag by tag, each in list order. */
  readonly removes?: readonly G['tag'][];

  /** The value a fresh instance starts with when the application gives none; 0 when absent. */
  readonly value?: number;

  /** How a re-application's value merges: a built-in rule or the game's own; `replace` when absent. */
  readonly merge?: AuraMerge | AuraMergeRule;

  /** Whether it stays when its value is spent to 0 (an absorb keeping its clock); it is removed when absent. */
  readonly keepWhenDepleted?: boolean;

  /** A beat while it lasts. */
  readonly periodic?: AuraPeriodic<G>;

  /** Whether only its bearer's own client sees it (a cooldown); everyone does when absent. */
  readonly ownerOnly?: boolean;

  /** Bearer states whose entry removes it (`enterState`): going down, dying, leaving. */
  readonly removedOn?: readonly G['state'][];

  /** Whether it is removed when its source is gone (`sourceGone`). */
  readonly boundToSource?: boolean;

  /** Whether its modifiers count right now; they always do when absent. Read at every fold. */
  readonly activeWhile?: (bearer: G['bearer']) => boolean;

  /** Whether it ends now, tested on every tick of its clock after the beats: a game's own expiry rule. */
  readonly expiresWhen?: (ctx: AuraContext<G>) => boolean;

  /** A clock rescale on its edges. */
  readonly rescale?: AuraRescale<G>;

  /** Procs run on every application that lands (a resource grant), before its lifecycle events. */
  readonly grants?: readonly G['proc'][];

  /** Cue ids by lifecycle change, which the client plays from what it sees on the wire. */
  readonly cues?: Readonly<Partial<Record<AuraChange, number>>>;

  /** The game's own data, which the framework never reads. */
  readonly data?: G['data'];

  /**
   * Runs on every application that lands on an instance (fresh or not), before any lifecycle event: the place to
   * capture the application's payload into `ctx.aura.ext`.
   */
  readonly onLand?: (ctx: AuraContext<G>, application: AuraApplication<G>) => void;

  /** A fresh instance landed. */
  readonly onApplied?: AuraHook<G>;

  /** An instance changed: its clock set again, its stacks or its value changed. */
  readonly onRefreshed?: AuraHook<G>;

  /** Its clock ran out, or `expiresWhen` said so. */
  readonly onExpired?: AuraHook<G>;

  /** It was taken off early: removed, cleansed, spent, evicted or ended by a state. */
  readonly onRemoved?: AuraHook<G>;

  /** Its bearer died while it was on it. */
  readonly onBearerDeath?: AuraHook<G>;
}

/** Fixes an aura definition's types; returns it unchanged. */
export const defineAura = <G extends AuraTypes = AuraTypes>(def: AuraDef<G>): AuraDef<G> => def;
