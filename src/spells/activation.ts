import type { AuraId } from '../auras/index.ts';
import { createRegistry, type Registry } from '../core/index.ts';
import type { Scaled } from '../modifiers/index.ts';
import type { CastReport, GateAnswer } from './cast-request.ts';
import type { MirrorCtx } from './mirror.ts';
import type { GateContext, SpellContext, StatsSource } from './spell-def.ts';
import type { ActivationShape, SpellTypes } from './spell-types.ts';

/**
 * A number of seconds read from the cast: a constant, or a function of the cast's context (its stats, typed by the
 * spell's `Source`, and its rank).
 */
export type CastSeconds<G extends SpellTypes, Source extends StatsSource<G> = StatsSource<G>> =
  | number
  | {
      /** Reads the seconds; declared as a method so a function over a narrower context still fits. */
      bivarianceHack(ctx: SpellContext<G, Source>): number;
    }['bivarianceHack'];

/**
 * An `auto` activation: the attack clock pulls it, on the casters that armed it (`spells.arm`).
 * After each cast it pulls, the clock is set, with no carry-over, to what `next` answers from the cast's report: the
 * interval read at the cast, or sooner.
 */
export interface AutoActivation<G extends SpellTypes = SpellTypes, Source extends StatsSource<G> = StatsSource<G>> {
  /** The discriminant. */
  readonly kind: 'auto';

  /** The seconds between casts, read at each cast (from its stats snapshot, usually). */
  readonly interval: CastSeconds<G, Source>;

  /**
   * Whether the caster is ready to try, asked on each step while the clock has run out and before any cast is
   * attempted: while it says no, the clock waits at zero and nothing is cast, refused or paid (a swing waiting on the
   * distance the game already measured to steer, so a walking horde polls no cast). Every step tries when absent.
   */
  readonly ready?: {
    /** Reads the caster; declared as a method so a function over a narrower caster still fits. */
    bivarianceHack(caster: G['bearer']): boolean;
  }['bivarianceHack'];

  /**
   * The seconds until the clock tries again after a cast it pulled, from 0, read from the cast's report and the interval
   * read at the cast (Whirlwind's refusal spends the interval, a swing out of reach tries again next step, a refusal
   * retries after 0.2 s). `autoNext` by default: a refusal for no target or out of reach tries on the next step;
   * anything else waits the interval.
   */
  readonly next?: {
    /** Reads the report; declared as a method so a function over a narrower caster still fits. */
    bivarianceHack(report: CastReport<G>, interval: number, caster: G['bearer']): number;
  }['bivarianceHack'];
}

/**
 * A button's cooldown in seconds, read from the caster as it fires: for a rule no scaled value
 * covers.
 */
export type ButtonSeconds<G extends SpellTypes> = {
  /** Reads the seconds; declared as a method so a function over a narrower caster still fits. */
  bivarianceHack(caster: G['bearer'], rank: number): number;
}['bivarianceHack'];

/** What a button costs as it fires: stacks of an aura on its caster (a charge, a rage bar); 1 stack when absent. */
export interface ButtonCost<G extends SpellTypes = SpellTypes> {
  /** The aura spent: its name in data, its id in code. */
  readonly aura: G['auraName'] | AuraId;

  /** The stacks spent, a whole number from 1; 1 when absent. */
  readonly stacks?: number;
}

/**
 * A `button` activation: a unit's key pulls it, through its loadout (`abilities.tryActivate`).
 * An ability **is** a spell with this activation: its cooldown is an aura on the slot it sits in, its cost is stacks of
 * an aura, `requires` and `blockedBy` are aura tags, and as it fires it pays, moves (`activate`), starts its cooldown,
 * lands `applies`, clears `resets`, then casts. The motion half (`activate`) reads and writes only the
 * bearer, so a prediction mirror runs it too.
 */
export interface ButtonActivation<G extends SpellTypes = SpellTypes> {
  /** The discriminant. */
  readonly kind: 'button';

  /**
   * The seconds the slot cools down for: a number, a scaled value of the caster's stats at the ability's rank
   * (`scaled(12, haste(0.5))`), or a function of the caster. None when absent.
   */
  readonly cooldown?: Scaled<G['stat']> | ButtonSeconds<G>;

  /**
   * When the cooldown starts: `activation` (as it fires, the default) or `cast`, only once its cast was not refused (a
   * placement the cast's gate checks).
   */
  readonly startsOn?: 'activation' | 'cast';

  /** What it costs as it fires; nothing when absent. */
  readonly cost?: ButtonCost<G>;

  /** Aura tags every one of which the caster must hold. */
  readonly requires?: readonly G['tag'][];

  /** Aura tags none of which the caster may hold (its slot's cooldown is always implied). */
  readonly blockedBy?: readonly G['tag'][];

  /** Aura tags whose auras it removes from the caster as it fires, after `applies` (another slot's cooldown). */
  readonly resets?: readonly G['tag'][];

  /**
   * Auras it lands on the caster as it fires, in order, each for its own length (a sprint, a stance); an aura whose
   * length a stat scales reads it in its own `duration`.
   */
  readonly applies?: readonly (G['auraName'] | AuraId)[];

  /**
   * The motion half as it fires, before its cooldown, auras and cast: a dodge's direction, from the press's input.
   * Mirror-safe: it reads only its `MirrorCtx`.
   */
  activate?(this: void, ctx: MirrorCtx<G>): void;
}

/**
 * A `passive` activation: the game casts it as a unit gains it and again after a revive, so its aura or area trigger
 * is held while the unit has it (F20).
 */
export interface PassiveActivation {
  /** The discriminant. */
  readonly kind: 'passive';
}

/** A `trigger` activation: something else casts it (a `castSpell` proc, an aura's trigger), never a unit's choice. */
export interface TriggerActivation {
  /** The discriminant. */
  readonly kind: 'trigger';
}

/** The framework's activation kinds, as a union. */
export type CoreActivation<G extends SpellTypes = SpellTypes, Source extends StatsSource<G> = StatsSource<G>> =
  | AutoActivation<G, Source>
  | ButtonActivation<G>
  | PassiveActivation
  | TriggerActivation;

/** One activation: a core kind or one of the game's; `Source` types the stats an `auto` interval reads. */
export type Activation<G extends SpellTypes, Source extends StatsSource<G> = StatsSource<G>> =
  | CoreActivation<G, Source>
  | G['gameActivation'];

/**
 * One activation kind: how its data is checked at load, the gate it adds before
 * the spell's own `canCast`, and how it explains itself. A game adds a kind by registering one more.
 * Its functions are standalone: the system may call them detached.
 */
export interface ActivationKindDef<A extends ActivationShape = ActivationShape, G extends SpellTypes = SpellTypes> {
  /** A problem with a spell's activation data, as a sentence, or `undefined` when it is sound. */
  check?(this: void, activation: A): string | undefined;

  /**
   * The kind's own gate, asked after the host's `canAct` and before the stats; a false refuses the cast as `gate`, one
   * of the game's reasons for that reason.
   */
  gate?(this: void, activation: A, ctx: GateContext<G>): GateAnswer<G>;

  /** The activation's numbers as data; its own numeric fields when absent. */
  explain?(this: void, activation: A): Readonly<Record<string, number>>;
}

/** Whether a number is a finite count of seconds from 0. */
const isSeconds = (value: number | undefined): boolean => value === undefined || (Number.isFinite(value) && value >= 0);

/** Whether an activation is the framework's `auto` kind. */
export const isAuto = <G extends SpellTypes>(activation: Activation<G>): activation is AutoActivation<G> =>
  activation.kind === 'auto' && Object.hasOwn(activation, 'interval');

/** The `auto` kind: its interval is a function or seconds above 0, its hooks functions. */
const AUTO: ActivationKindDef<AutoActivation, never> = {
  check: (activation) => {
    const { interval } = activation;
    const isSound = typeof interval === 'function' || (Number.isFinite(interval) && interval > 0);

    if (activation.ready !== undefined && typeof activation.ready !== 'function') {
      return "an auto clock's ready is a function of the caster.";
    }

    if (activation.next !== undefined && typeof activation.next !== 'function') {
      return "an auto clock's next is a function of the cast's report.";
    }

    return isSound ? undefined : 'an auto interval must be above 0 seconds.';
  },
};

/** Whether an activation is the framework's `button` kind. */
export const isButton = <G extends SpellTypes>(activation: Activation<G>): activation is ButtonActivation<G> =>
  activation.kind === 'button';

/** Whether a button's cost is sound: a whole number of stacks from 1. */
const isCost = (cost: ButtonCost | undefined): boolean =>
  cost?.stacks === undefined || (Number.isInteger(cost.stacks) && cost.stacks >= 1);

/** The `button` kind: its cooldown seconds from 0 (a number's; a scaled value is checked by the ability system). */
const BUTTON: ActivationKindDef<ButtonActivation, never> = {
  check: (activation) => {
    const { cooldown, startsOn } = activation;

    if (typeof cooldown === 'number' && !isSeconds(cooldown)) {
      return 'a button cooldown takes seconds from 0.';
    }

    if (startsOn !== undefined && startsOn !== 'activation' && startsOn !== 'cast') {
      return "a button cooldown starts on 'activation' or 'cast'.";
    }

    return isCost(activation.cost) ? undefined : 'a button costs a whole number of stacks from 1.';
  },
};

/** A kind with nothing to check or supply. */
const PLAIN: ActivationKindDef<ActivationShape, never> = {};

/**
 * The framework's activation kinds, typed over no game (`never`) since none has a gate, so they register
 * into any game's activation registry: `auto` (the attack clock, `spells.stepAuto`), `button` (abilities,
 * `abilities.tryActivate`), `passive` (cast by the game as a unit gains it), and `trigger` (cast by procs, triggers and a
 * creature's brain). A game registers them with its own (a director's `event`, a `totem`):
 * `defineActivations({ ...CORE_ACTIVATIONS, totem: TOTEM })`.
 */
export const CORE_ACTIVATIONS: {
  readonly auto: ActivationKindDef<AutoActivation, never>;
  readonly button: ActivationKindDef<ButtonActivation, never>;
  readonly passive: ActivationKindDef<PassiveActivation, never>;
  readonly trigger: ActivationKindDef<TriggerActivation, never>;
} = Object.freeze({ auto: AUTO, button: BUTTON, passive: PLAIN, trigger: PLAIN });

/** A registry of activation kinds: ids by key order, each kind's definition, typed by the game's spell types. */
export type ActivationRegistry<G extends SpellTypes = SpellTypes> = Registry<
  'activations',
  string,
  ActivationKindDef<ActivationShape, G>,
  never
>;

/** Fixes an activation kind's types; returns it unchanged. */
export const defineActivationKind = <A extends ActivationShape, G extends SpellTypes = SpellTypes>(
  def: ActivationKindDef<A, G>,
): ActivationKindDef<A, G> => def;

/**
 * Registers the activation kinds a game's spells use: `defineActivations({ ...CORE_ACTIVATIONS,
 * ...GAME_ACTIVATIONS })`. Each kind gets a dense id by key order, which the spell registry's `activation` column holds.
 */
export const defineActivations = <G extends SpellTypes = SpellTypes>(
  kinds: Readonly<Record<string, ActivationKindDef<ActivationShape, G>>>,
): ActivationRegistry<G> =>
  createRegistry<Readonly<Record<string, ActivationKindDef<ActivationShape, G>>>, 'activations'>(kinds, {
    kind: 'activations',
  });
