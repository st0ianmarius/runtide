import type { ActivationKindDef, ActivationRegistry, CastSeconds } from './activation.ts';
import type { AnySpellDef } from './spell-def.ts';
import type { ActivationShape, SpellTypes } from './spell-types.ts';
import type { SpellTagTable } from './tags.ts';

/** What a spell is checked against at load. */
interface CheckParts<G extends SpellTypes> {
  /** The activation kinds. */
  readonly activations: ActivationRegistry<G>;

  /** The spell tags. */
  readonly tags: SpellTagTable<G['spellTag']>;
}

/** The most ranks a spell can declare (its column is a byte). */
const MAX_RANKS = 255;

/** The hooks a definition may carry, each a function when present. */
const HOOK_FIELDS = ['state', 'canCast', 'target', 'begin', 'onHit', 'onEnd'] as const;

/** Throws a `RangeError` naming the spell. */
const fail = (name: string, message: string): never => {
  throw new RangeError(`Spell ${name}: ${message}`);
};

/** Whether stage seconds are sound: a function, or a finite number from 0. */
const isSoundSeconds = <G extends SpellTypes>(seconds: CastSeconds<G> | undefined): boolean =>
  seconds === undefined || typeof seconds === 'function' || (Number.isFinite(seconds) && seconds >= 0);

/** Checks the activation: a kind the registry has, with data its own check accepts. */
const checkActivation = <G extends SpellTypes>(name: string, def: AnySpellDef<G>, parts: CheckParts<G>): void => {
  const ids: Readonly<Record<string, number | undefined>> = parts.activations.id;
  const { activation } = def;
  const id = ids[activation.kind];

  const kind: ActivationKindDef<ActivationShape, G> | undefined =
    id === undefined ? undefined : parts.activations.defs[id];

  if (kind === undefined) {
    fail(name, `unknown activation kind ${activation.kind}.`);
  }

  const problem = kind?.check?.(activation);

  if (problem !== undefined) {
    fail(name, problem);
  }
};

/** Checks the ranks, the tags and the hooks. */
const checkShape = <G extends SpellTypes>(name: string, def: AnySpellDef<G>, parts: CheckParts<G>): void => {
  const ranks = def.ranks ?? 1;

  if (!Number.isInteger(ranks) || ranks < 1 || ranks > MAX_RANKS) {
    fail(name, `ranks must be a whole number from 1 to ${MAX_RANKS}.`);
  }

  const tagIds: Readonly<Record<string, number | undefined>> = parts.tags.id;
  const unknown = (def.tags ?? []).find((tag) => tagIds[tag] === undefined);

  if (unknown !== undefined) {
    fail(name, `unknown spell tag ${unknown}.`);
  }

  if (typeof def.release !== 'function') {
    fail(name, 'release must be a function.');
  }

  const notFunction = HOOK_FIELDS.find((hook) => def[hook] !== undefined && typeof def[hook] !== 'function');

  if (notFunction !== undefined) {
    fail(name, `${notFunction} must be a function.`);
  }
};

/** Checks the timeline: stage seconds from 0 (or functions), a beat above 0, interrupts that pause or cancel. */
const checkTimeline = <G extends SpellTypes>(name: string, def: AnySpellDef<G>): void => {
  const { timeline } = def;

  if (timeline === undefined) {
    return;
  }

  const stages = [timeline.windup?.seconds, timeline.channel?.seconds, timeline.recover?.seconds];

  if (!stages.every(isSoundSeconds)) {
    fail(name, 'a stage lasts a finite number of seconds from 0, or a function.');
  }

  const every = timeline.channel?.every;

  if (every !== undefined && !(Number.isFinite(every) && every > 0)) {
    fail(name, 'a channel beat must be a finite number of seconds above 0.');
  }

  const answers: readonly (string | undefined)[] = Object.values(timeline.interrupts ?? {});

  if (answers.some((answer) => answer !== 'pause' && answer !== 'cancel')) {
    fail(name, "an interrupt answers 'pause' or 'cancel'.");
  }
};

/**
 * Checks one spell at load, throwing a `RangeError` naming it: its activation kind and data, its ranks, tags and
 * hooks, and its timeline. Its stats and shares are checked as they compile.
 */
export const checkSpell = <G extends SpellTypes>(name: string, def: AnySpellDef<G>, parts: CheckParts<G>): void => {
  checkActivation(name, def, parts);
  checkShape(name, def, parts);
  checkTimeline(name, def);
};
