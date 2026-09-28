import { createRegistry, type Registry } from '../core/index.ts';
import type { SpellContext } from './spell-def.ts';
import type { ActivationShape, SpellTypes } from './spell-types.ts';

/** A number of seconds read from the cast: a constant, or a function of the cast's context (its stats, its rank). */
export type CastSeconds<G extends SpellTypes> =
  | number
  | {
      /** Reads the seconds; declared as a method so a function over a narrower context still fits. */
      bivarianceHack(ctx: SpellContext<G>): number;
    }['bivarianceHack'];

/**
 * An `auto` activation (§II.3.2, §II.6 S2): the attack clock pulls it. The clock counts while the spell is not owned
 * (so a new spell fires at once), resets to the interval read at the cast (no carry-over), and answers each way a
 * cast can fail with `spend` (the whole interval) or `retry` (again after `retry` seconds).
 */
export interface AutoActivation<G extends SpellTypes = SpellTypes> {
  /** The discriminant. */
  readonly kind: 'auto';

  /** The seconds between casts, read at each cast (from its stats snapshot, usually). */
  readonly interval: CastSeconds<G>;

  /** The seconds before a retry; 0 (the next step) when absent. */
  readonly retry?: number;

  /** What a refusal by the gates or `canCast` costs: `spend` (the default) or `retry`. */
  readonly onRefused?: 'spend' | 'retry';

  /** What a cast whose `target` found nothing costs: `retry` (the default) or `spend`. */
  readonly onNoTarget?: 'spend' | 'retry';

  /** What an instant cast whose release set nothing off costs (a swing that never went out): `retry` by default. */
  readonly onMiss?: 'spend' | 'retry';
}

/** A `button` activation: a unit's key pulls it. The button's rules (cooldown, cost, loadout) land with abilities (F9). */
export interface ButtonActivation {
  /** The discriminant. */
  readonly kind: 'button';
}

/** A `passive` activation: owning the spell is what casts it (an aura or area trigger held while owned, F20). */
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

  /** Seconds before the same caster may pick it again (the picker's, F17). */
  readonly cooldown?: number;

  /** The farthest a cast may start from (the gates', F16). */
  readonly range?: number;

  /** Whether a clear line to the target is needed to start (the gates', F16). */
  readonly sight?: boolean;

  /** What the cast holds of a shared budget while it winds up (the budget policies', F17). */
  readonly budget?: number;

  /** The pick weight, as a number (the picker's, F17). */
  readonly weight?: number;
}

/** An `event` activation: the world's director pulls it (a map event). Its rules are the game's director's. */
export interface EventActivation {
  /** The discriminant. */
  readonly kind: 'event';

  /** The pick weight, as a number. */
  readonly weight?: number;
}

/** The framework's activation kinds, as a union. */
export type CoreActivation<G extends SpellTypes = SpellTypes> =
  | AutoActivation<G>
  | ButtonActivation
  | PassiveActivation
  | TriggerActivation
  | AiActivation
  | EventActivation;

/** One activation (§II.3.2): a core kind or one of the game's. */
export type Activation<G extends SpellTypes> = CoreActivation<G> | G['gameActivation'];

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

  /** The kind's own gate, asked before the spell's `canCast`; a false refuses the cast. */
  gate?(this: void, activation: A, ctx: SpellContext<G>): boolean;

  /** The activation's numbers as data (§I.5.3); its own numeric fields when absent. */
  explain?(this: void, activation: A): Readonly<Record<string, number>>;
}

/** Whether a number is a finite count of seconds from 0. */
const isSeconds = (value: number | undefined): boolean =>
  value === undefined || (Number.isFinite(value) && value >= 0);

/** The `auto` kind: its interval is a function or seconds above 0, its retry seconds from 0. */
const AUTO: ActivationKindDef<AutoActivation> = {
  check: (activation) => {
    const { interval, retry } = activation;
    const isSound = typeof interval === 'function' || (Number.isFinite(interval) && interval > 0);

    return isSound && isSeconds(retry) ? undefined : 'an auto interval must be above 0 and its retry from 0 seconds.';
  },
};

/** The `ai` kind: its windup, lock and recovery are the timeline's defaults. */
const AI: ActivationKindDef<AiActivation> = {
  check: (activation) =>
    [activation.windup, activation.lock, activation.recover, activation.cooldown].every(isSeconds)
      ? undefined
      : 'an ai activation takes seconds from 0.',

  timeline: (activation) => ({
    windup: activation.windup,
    recover: activation.recover,
    lockBefore: activation.lock,
  }),
};

/** A kind with nothing to check or supply. */
const PLAIN: ActivationKindDef = {};

/**
 * The framework's activation kinds (§II.3.2): `auto` (the attack clock, `spells.stepAuto`), `button` (F9's
 * abilities), `passive` (owning it, F20), `trigger` (cast by procs and triggers), `ai` (a creature's brain, F17) and
 * `event` (the world's director). A game registers them with its own: `defineActivations({ ...CORE_ACTIVATIONS,
 * totem: TOTEM })`.
 */
export const CORE_ACTIVATIONS: {
  readonly auto: ActivationKindDef<AutoActivation>;
  readonly button: ActivationKindDef<ButtonActivation>;
  readonly passive: ActivationKindDef<PassiveActivation>;
  readonly trigger: ActivationKindDef<TriggerActivation>;
  readonly ai: ActivationKindDef<AiActivation>;
  readonly event: ActivationKindDef<EventActivation>;
} = Object.freeze({ auto: AUTO, button: PLAIN, passive: PLAIN, trigger: PLAIN, ai: AI, event: PLAIN });

/** A registry of activation kinds: ids by key order, each kind's definition. */
export type ActivationRegistry = Registry<'activations', string, ActivationKindDef, never, never>;

/** Fixes an activation kind's types; returns it unchanged. */
export const defineActivationKind = <A extends ActivationShape, G extends SpellTypes = SpellTypes>(
  def: ActivationKindDef<A, G>,
): ActivationKindDef<A, G> => def;

/**
 * Registers the activation kinds a game's spells use (§I.5.6 hatch 2): `defineActivations({ ...CORE_ACTIVATIONS,
 * ...GAME_ACTIVATIONS })`. Each kind gets a dense id by key order, which the spell registry's `activation` column holds.
 */
export const defineActivations = (kinds: Readonly<Record<string, ActivationKindDef>>): ActivationRegistry =>
  createRegistry<Readonly<Record<string, ActivationKindDef>>, 'activations'>(kinds, { kind: 'activations' });
