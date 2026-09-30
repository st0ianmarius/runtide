import type { CueId } from '../cues/index.ts';
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
 * - `independent`: every application is its own instance with its own clock, `maxStacks` of them at most (at the
 *   cap the one with least time left makes way, the first of equals).
 */
export type AuraStacking = 'refresh' | 'extend' | 'stack' | 'highest' | 'independent';

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
  incoming: IncomingAura
) => Restack | undefined;

/**
 * How an application's value merges into the value already there, independently of how the clocks stack: `max`
 * keeps the larger, `add` sums them, `replace` takes the new one.
 */
export type AuraMerge = 'max' | 'add' | 'replace';

/** A game's own value merge: the value after a re-application. */
export type AuraMergeRule = (current: number, incoming: number) => number;

/** What happened to an aura on its bearer, as hooks and events are told. */
export type AuraChange = 'applied' | 'refreshed' | 'expired' | 'removed' | 'stateEntered';

/**
 * Why a change happened: the operation (or the step of an application) that caused it, WoW's aura remove mode and
 * more. `cleanse` and `evict` are the removals an application makes before it lands; `tick` covers expiries and beats.
 */
export type AuraCause =
  | 'apply'
  | 'cleanse'
  | 'evict'
  | 'remove'
  | 'removeByTag'
  | 'dispel'
  | 'spendStacks'
  | 'spendValue'
  | 'refresh'
  | 'tick'
  | 'enterState'
  | 'sourceGone';

/** A lifecycle hook: procs credited to the aura's source, or `undefined` for none. */
export type AuraHook<G extends AuraTypes> = (ctx: AuraContext<G>) => readonly G['proc'][] | undefined;

/**
 * A beat on a clock of its own while the aura lasts: damage or healing over time, a sweep, a pulse. Beats
 * of one tick fire before that tick's expiries, so a 12 s aura beating every 3 s beats four times, the last on the
 * tick it runs out. A refresh keeps the beat.
 */
export interface AuraPeriodic<G extends AuraTypes> {
  /**
   * Seconds between beats, above 0, the first one `every` after the application; read at every beat when a function
   * (a period from live stats). A beat that should skip (a regeneration paused by a wound) returns no procs.
   */
  readonly every: number | ((ctx: AuraContext<G>) => number);

  /** The beat: procs credited to the aura's source. */
  readonly onBeat: (ctx: AuraContext<G>) => readonly G['proc'][] | undefined;
}

/**
 * One aura, as data and standalone functions: a timed state on any bearer. It carries no id; the registry
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

  /**
   * The game's own hooks this aura answers (`AuraTypes.auraHooks`), which the game's own stages walk: a threat hook, a
   * resource hook. None when absent.
   */
  readonly on?: Readonly<Partial<G['auraHooks']>>;

  /** A beat while it lasts. */
  readonly periodic?: AuraPeriodic<G>;

  /**
   * Who sees it on the wire: its bearer's own client alone (`owner`: a cooldown), its bearer's party too (`party`: a
   * raid frame's debuffs), or everyone (`all`, the default).
   */
  readonly audience?: 'owner' | 'party' | 'all';

  /**
   * Whether a prediction mirror rebuilds it from the wire (`auras.seed`): an aura the shared motion step
   * reads (a cooldown, a cost, a sprint, a state a button's rules name) must be; `checkPredicted` holds the rule.
   */
  readonly predicted?: boolean;

  /** Bearer states whose entry removes it (`enterState`): going down, dying, leaving. */
  readonly removedOn?: readonly G['state'][];

  /** Whether it is removed when its source is gone (`sourceGone`). */
  readonly boundToSource?: boolean;

  /**
   * The event listeners it owns: active exactly while it is on its bearer. The aura system never reads
   * them; a trigger system compiles them at load.
   */
  readonly triggers?: readonly G['trigger'][];

  /**
   * Cues by lifecycle change, each a `self` or `entity` cue that sits on the bearer: the client
   * plays them from what it sees of the aura on the wire (zero bytes), or a local game fires them from the aura events
   * (`auraCue`). The aura system never reads them; `checkAuraCues` holds them against the cue registry at load.
   */
  readonly cues?: Readonly<Partial<Record<AuraChange, CueId>>>;

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

  /** Its clock ran out. */
  readonly onExpired?: AuraHook<G>;

  /** It was taken off early: removed, cleansed, spent, evicted or ended by a state. */
  readonly onRemoved?: AuraHook<G>;

  /**
   * Its bearer entered a bearer state (`auras.enterState`: a death, a despawn, going down) while it was on it, before
   * the auras `removedOn` that state went: a death burst is an `onState` of `dead`.
   */
  readonly onState?: (ctx: AuraContext<G>, state: G['state']) => readonly G['proc'][] | undefined;
}

/** Fixes an aura definition's types; returns it unchanged. */
export const defineAura = <G extends AuraTypes = AuraTypes>(def: AuraDef<G>): AuraDef<G> => def;
