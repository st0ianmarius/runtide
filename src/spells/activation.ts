import type { AuraId } from '../auras/index.ts';
import { createRegistry, type Registry } from '../core/index.ts';
import type { Scaled } from '../modifiers/index.ts';
import type { MirrorCtx } from './mirror.ts';
import type { ReachDefaults } from './reach.ts';
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
 * An `auto` activation (§II.3.2, §II.6 S2): the attack clock pulls it, on the casters that armed it (`spells.arm`).
 * The clock resets to the interval read at the cast (no carry-over), and answers each way a cast can fail with `spend`
 * (the whole interval) or `retry` (again after `retry` seconds).
 */
export interface AutoActivation<G extends SpellTypes = SpellTypes, Source extends StatsSource<G> = StatsSource<G>> {
  /** The discriminant. */
  readonly kind: 'auto';

  /** The seconds between casts, read at each cast (from its stats snapshot, usually). */
  readonly interval: CastSeconds<G, Source>;

  /** The seconds before a retry; 0 (the next step) when absent. */
  readonly retry?: number;

  /**
   * Whether the caster is ready to try, asked on each step while the clock has run out and before any cast is
   * attempted: while it says no, the clock waits at zero and nothing is cast, refused or paid (a swing waiting on the
   * distance the game already measured to steer, so a walking horde polls no cast). Every step tries when absent.
   */
  readonly ready?: {
    /** Reads the caster; declared as a method so a function over a narrower caster still fits. */
    bivarianceHack(caster: G['bearer']): boolean;
  }['bivarianceHack'];

  /** What a refusal by the gates or `canCast` costs: `spend` (the default) or `retry`. */
  readonly onRefused?: 'spend' | 'retry';

  /** What a cast whose `target` found nothing, or found it out of reach, costs: `retry` (the default) or `spend`. */
  readonly onNoTarget?: 'spend' | 'retry';

  /** What an instant cast whose release set nothing off costs (a swing that never went out): `retry` by default. */
  readonly onMiss?: 'spend' | 'retry';

  /**
   * What the caster's other casts do to the clock (§II.6 S3: a creature's swing reset after its cast's recovery):
   * `reset` holds it while the caster casts and sets it to its interval (the constant, else the one last read) as each
   * cast ends; `keep` (the default) leaves it counting.
   */
  readonly afterCast?: 'reset' | 'keep';
}

/**
 * A button's cooldown in seconds, read from the caster as it fires (§I.5.6 hatch 2): for a rule no scaled value
 * covers.
 */
export type ButtonSeconds<G extends SpellTypes> = {
  /** Reads the seconds; declared as a method so a function over a narrower caster still fits. */
  bivarianceHack(caster: G['bearer'], rank: number): number;
}['bivarianceHack'];

/** What a button costs as it fires: stacks of an aura on its caster (a charge, a rage bar); 1 stack when absent. */
export interface ButtonCost {
  /** The aura spent. */
  readonly aura: AuraId;

  /** The stacks spent, a whole number from 1; 1 when absent. */
  readonly stacks?: number;
}

/**
 * An aura a button lands on its caster as it fires, for the aura's own length, multiplied by a stat of the caster's
 * when it names one (a Duration stat, §II.6 S4).
 */
export interface ButtonApply<G extends SpellTypes = SpellTypes> {
  /** The aura. */
  readonly aura: AuraId;

  /** The stat whose total multiplies the aura's length; its own length when absent. */
  readonly scaledBy?: G['stat'];
}

/**
 * A `button` activation (§II.3.2, §I.6 Abilities): a unit's key pulls it, through its loadout (`abilities.tryActivate`).
 * An ability **is** a spell with this activation: its cooldown is an aura on the slot it sits in, its cost is stacks of
 * an aura, `requires` and `blockedBy` are aura tags, and as it fires it pays, moves (`activate`), starts its cooldown,
 * lands `applies`, clears `resets`, then casts. The motion half (`activate`, `travel`) reads and writes only the
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
   * placement the cast checks).
   */
  readonly startsOn?: 'activation' | 'cast';

  /** What it costs as it fires; nothing when absent. */
  readonly cost?: ButtonCost;

  /** Aura tags every one of which the caster must hold. */
  readonly requires?: readonly G['tag'][];

  /** Aura tags none of which the caster may hold (its slot's cooldown is always implied). */
  readonly blockedBy?: readonly G['tag'][];

  /** Aura tags whose auras it removes from the caster as it fires, after `applies` (another slot's cooldown). */
  readonly resets?: readonly G['tag'][];

  /** Auras it lands on the caster as it fires, in order (a sprint, a stance). */
  readonly applies?: readonly ButtonApply<G>[];

  /**
   * The motion half as it fires, before its cooldown, auras and cast: a dodge's direction, from the press's input.
   * Mirror-safe: it reads only its `MirrorCtx`.
   */
  activate?(this: void, ctx: MirrorCtx<G>): void;

  /**
   * The motion half on every motion step while equipped (`abilities.travel`): a dodge carrying its bearer by `ctx.dt`
   * through the static world. Mirror-safe: it reads only its `MirrorCtx`.
   */
  travel?(this: void, ctx: MirrorCtx<G>): void;
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

/**
 * An `ai` activation: a creature's brain picks it (F17). Its windup and recovery are the timeline's defaults, and a
 * spell with a `target` hook tracks its target until `lock` seconds before the release (`lockBefore(lock)`).
 */
export interface AiActivation {
  /** The discriminant. */
  readonly kind: 'ai';

  /** Seconds from the cast's start to its release, when the timeline declares no windup. */
  readonly windup: number;

  /** Seconds before the release when the aim stops tracking; without it the aim locks at the start. */
  readonly lock?: number;

  /** Seconds the caster stays busy after the release, when the timeline declares no recovery. */
  readonly recover?: number;

  /** The farthest its target may be as the cast starts (its reach's range, §I.7.1 F16). */
  readonly range?: number;

  /** Whether a clear line to its target is needed as the cast starts (its reach's sight). */
  readonly sight?: boolean;

  /** The pick weight, as a number: the picker's default for the spell, 1 when absent (F17). */
  readonly weight?: number;
}

/** The framework's activation kinds, as a union. */
export type CoreActivation<G extends SpellTypes = SpellTypes, Source extends StatsSource<G> = StatsSource<G>> =
  AutoActivation<G, Source> | ButtonActivation<G> | PassiveActivation | TriggerActivation | AiActivation;

/** One activation (§II.3.2): a core kind or one of the game's; `Source` types the stats an `auto` interval reads. */
export type Activation<G extends SpellTypes, Source extends StatsSource<G> = StatsSource<G>> =
  CoreActivation<G, Source> | G['gameActivation'];

/** The timeline an activation kind supplies where the spell's own timeline says nothing. */
export interface TimelineDefaults {
  /** The windup's seconds. */
  readonly windup?: number | undefined;

  /** The recovery's seconds. */
  readonly recover?: number | undefined;

  /** Tracks the target (through the spell's `target` hook) until this many seconds before the release. */
  readonly lockBefore?: number | undefined;
}

/**
 * One activation kind (§II.3.2): how its data is checked at load, which timeline it supplies, the gate it adds before
 * the spell's own `canCast`, and how it explains itself. A game adds a kind by registering one more (§I.5.6 hatch 2).
 * Its functions are standalone: the system may call them detached.
 */
export interface ActivationKindDef<A extends ActivationShape = ActivationShape, G extends SpellTypes = SpellTypes> {
  /** A problem with a spell's activation data, as a sentence, or `undefined` when it is sound. */
  check?(this: void, activation: A): string | undefined;

  /** The timeline defaults the kind supplies. */
  timeline?(this: void, activation: A): TimelineDefaults | undefined;

  /** The reach rules the kind supplies where the spell declares none (§I.7.1 F16). */
  reach?(this: void, activation: A): ReachDefaults | undefined;

  /** The kind's own gate, asked after the host's `canAct` and before the stats; a false refuses the cast. */
  gate?(this: void, activation: A, ctx: GateContext<G>): boolean;

  /** The activation's numbers as data (§I.5.3); its own numeric fields when absent. */
  explain?(this: void, activation: A): Readonly<Record<string, number>>;
}

/** Whether a number is a finite count of seconds from 0. */
const isSeconds = (value: number | undefined): boolean => value === undefined || (Number.isFinite(value) && value >= 0);

/** Whether an activation is the framework's `auto` kind. */
export const isAuto = <G extends SpellTypes>(activation: Activation<G>): activation is AutoActivation<G> =>
  activation.kind === 'auto' && Object.hasOwn(activation, 'interval');

/** The `auto` kind: its interval is a function or seconds above 0, its retry seconds from 0. */
const AUTO: ActivationKindDef<AutoActivation, never> = {
  check: (activation) => {
    const { interval, retry } = activation;
    const isSound = typeof interval === 'function' || (Number.isFinite(interval) && interval > 0);

    if (activation.afterCast !== undefined && activation.afterCast !== 'reset' && activation.afterCast !== 'keep') {
      return "an auto clock's afterCast is 'reset' or 'keep'.";
    }

    if (activation.ready !== undefined && typeof activation.ready !== 'function') {
      return "an auto clock's ready is a function of the caster.";
    }

    return isSound && isSeconds(retry) ? undefined : 'an auto interval must be above 0 and its retry from 0 seconds.';
  },
};

/** Whether an activation is the framework's `ai` kind. */
export const isAi = <G extends SpellTypes>(activation: Activation<G>): activation is AiActivation =>
  activation.kind === 'ai' && Object.hasOwn(activation, 'windup');

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

/** The `ai` kind: its windup, lock and recovery are the timeline's defaults, its range and sight the reach's. */
const AI: ActivationKindDef<AiActivation, never> = {
  check: (activation) =>
    [activation.windup, activation.lock, activation.recover].every(isSeconds) &&
    (activation.weight === undefined || (Number.isFinite(activation.weight) && activation.weight >= 0))
      ? undefined
      : 'an ai activation takes seconds from 0 and a weight from 0.',

  timeline: (activation) => ({
    windup: activation.windup,
    recover: activation.recover,
    lockBefore: activation.lock,
  }),

  reach: (activation) => ({ range: activation.range, sight: activation.sight }),
};

/** A kind with nothing to check or supply. */
const PLAIN: ActivationKindDef<ActivationShape, never> = {};

/**
 * The framework's activation kinds (§II.3.2), typed over no game (`never`) since none has a gate, so they register
 * into any game's activation registry: `auto` (the attack clock, `spells.stepAuto`), `button` (abilities,
 * `abilities.tryActivate`), `passive` (cast by the game as a unit gains it), `trigger` (cast by procs and triggers) and
 * `ai` (a creature's brain, F17). A game registers them with its own (a director's `event`, a `totem`):
 * `defineActivations({ ...CORE_ACTIVATIONS, totem: TOTEM })`.
 */
export const CORE_ACTIVATIONS: {
  readonly auto: ActivationKindDef<AutoActivation, never>;
  readonly button: ActivationKindDef<ButtonActivation, never>;
  readonly passive: ActivationKindDef<PassiveActivation, never>;
  readonly trigger: ActivationKindDef<TriggerActivation, never>;
  readonly ai: ActivationKindDef<AiActivation, never>;
} = Object.freeze({ auto: AUTO, button: BUTTON, passive: PLAIN, trigger: PLAIN, ai: AI });

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
 * Registers the activation kinds a game's spells use (§I.5.6 hatch 2): `defineActivations({ ...CORE_ACTIVATIONS,
 * ...GAME_ACTIVATIONS })`. Each kind gets a dense id by key order, which the spell registry's `activation` column holds.
 */
export const defineActivations = <G extends SpellTypes = SpellTypes>(
  kinds: Readonly<Record<string, ActivationKindDef<ActivationShape, G>>>,
): ActivationRegistry<G> =>
  createRegistry<Readonly<Record<string, ActivationKindDef<ActivationShape, G>>>, 'activations'>(kinds, {
    kind: 'activations',
  });
