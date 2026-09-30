import type { AnyAreaTriggerDef } from './area-def.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaTagTable } from './tags.ts';

/** The hooks a definition may carry, each a function when present. */
const HOOK_FIELDS = ['state', 'init', 'move', 'frame', 'onContact', 'onLand', 'onExpire', 'onEnd', 'view'] as const;

/** The parts of a frame an `order` may list. */
const PHASES: ReadonlySet<string> = new Set(['move', 'contact', 'frame', 'pulses', 'auras']);

/** The shape kinds a definition may hold. */
const SHAPE_KINDS: ReadonlySet<string> = new Set([
  'point',
  'circle',
  'ring',
  'cone',
  'lane',
  'polygon',
  'outside',
  'union',
  'difference',
]);

/** Throws a `RangeError` naming the area trigger kind. */
const fail = (name: string, message: string): never => {
  throw new RangeError(`Area trigger ${name}: ${message}`);
};

/** Whether a value is one of a few strings, or absent. */
const isOneOf = (value: unknown, allowed: readonly string[]): boolean =>
  value === undefined || (typeof value === 'string' && allowed.includes(value));

/** Checks the shape and the lifetime. */
const checkShapeAndLifetime = <G extends AreaTriggerTypes>(name: string, def: AnyAreaTriggerDef<G>): void => {
  const { shape, lifetime } = def;

  if (typeof shape !== 'function' && !SHAPE_KINDS.has(shape.kind)) {
    fail(name, `unknown shape kind ${shape.kind}.`);
  }

  const isSound =
    typeof lifetime === 'function' ||
    lifetime === 'owner' ||
    lifetime === 'spent' ||
    (typeof lifetime === 'number' && Number.isFinite(lifetime) && lifetime > 0);

  if (!isSound) {
    fail(name, "its lifetime is a finite number of seconds above 0, 'owner', 'spent', or a function.");
  }
};

/** Checks the modes: expiry, anchor, insertion and tick slot. */
const checkModes = <G extends AreaTriggerTypes>(name: string, def: AnyAreaTriggerDef<G>): void => {
  if (!isOneOf(def.expiry, ['after', 'before', 'clip'])) {
    fail(name, "its expiry is 'after', 'before' or 'clip'.");
  }

  if (!isOneOf(def.anchor, ['world', 'owner'])) {
    fail(name, "its anchor is 'world' or 'owner'.");
  }

  const slot = def.tickIn ?? 0;

  if (!Number.isInteger(slot) || slot < 0) {
    fail(name, `its tick slot ${slot} is not a slot id.`);
  }
};

/** Checks the bound. */
const checkBound = <G extends AreaTriggerTypes>(name: string, def: AnyAreaTriggerDef<G>): void => {
  const { bound } = def;

  if (bound === undefined) {
    return;
  }

  if (!isOneOf(bound.owner, ['present'])) {
    fail(name, "its bound's owner is 'present' when given.");
  }

  if (
    (bound.when !== undefined && typeof bound.when !== 'function') ||
    (bound.suspendWhile !== undefined && typeof bound.suspendWhile !== 'function')
  ) {
    fail(name, "its bound's when and suspendWhile are functions.");
  }
};

/** Checks the limit. */
const checkLimit = <G extends AreaTriggerTypes>(name: string, def: AnyAreaTriggerDef<G>): void => {
  const { limit } = def;

  if (limit === undefined) {
    return;
  }

  const { perOwner } = limit;

  if (typeof perOwner !== 'function' && !(Number.isInteger(perOwner) && perOwner >= 1)) {
    fail(name, 'its limit per owner is a whole number from 1, or a function.');
  }

  if (!isOneOf(limit.replace, ['oldest', 'refuse'])) {
    fail(name, "its limit replaces 'oldest' or 'refuse'.");
  }
};

/** Whether seconds are sound: a finite number above 0 (from 0 when `zero`), or a function. */
const isSoundSeconds = (seconds: unknown, zero = false): boolean =>
  typeof seconds === 'function' ||
  (typeof seconds === 'number' && Number.isFinite(seconds) && (zero ? seconds >= 0 : seconds > 0));

/** Checks the frame's order and its contact. */
const checkFrame = <G extends AreaTriggerTypes>(name: string, def: AnyAreaTriggerDef<G>): void => {
  const { order, contact } = def;

  if (order !== undefined && (new Set(order).size !== order.length || order.some((phase) => !PHASES.has(phase)))) {
    fail(name, "its order lists 'move', 'contact', 'frame', 'pulses' and 'auras', each at most once.");
  }

  if (contact !== undefined && !isSoundSeconds(contact.radius, true)) {
    fail(name, 'its contact radius is a finite number from 0, or a function.');
  }
};

/** Checks one pulse's seconds, modes and hook, throwing a message naming it. */
const checkBeat = <G extends AreaTriggerTypes>(
  pulse: NonNullable<AnyAreaTriggerDef<G>['every']>[number],
): string | undefined => {
  if (!isSoundSeconds(pulse.seconds) || !isSoundSeconds(pulse.first ?? 1, true)) {
    return 'beats every finite number of seconds above 0, the first after seconds from 0.';
  }

  if (!isOneOf(pulse.reschedule, ['cadence', 'restart'])) {
    return 'has an unknown reschedule.';
  }

  const isShape = pulse.hits === undefined || pulse.hits === 'none' || SHAPE_KINDS.has(pulse.hits.kind);

  return typeof pulse.onPulse === 'function' && isShape
    ? undefined
    : 'needs an onPulse function, and hits a shape, or none.';
};

/** Checks every pulse. */
const checkPulse = <G extends AreaTriggerTypes>(name: string, pulses: AnyAreaTriggerDef<G>['every']): void => {
  for (const [index, pulse] of (pulses ?? []).entries()) {
    const problem = checkBeat(pulse);

    if (problem !== undefined) {
      fail(name, `its pulse ${index} ${problem}`);
    }
  }
};

/** The problem with one ledger's spec, or `undefined`. */
const ledgerProblem = (
  spec: NonNullable<AnyAreaTriggerDef<AreaTriggerTypes>['ledgers']>[string],
): string | undefined => {
  if (!isOneOf(spec.policy, ['once', 'repeat', 'rehit']) || !isOneOf(spec.scope, ['self', 'cast'])) {
    return 'has an unknown policy or scope.';
  }

  if (spec.share !== undefined && !(spec.share >= 0 && spec.share <= 1)) {
    return 'takes a share from 0 to 1.';
  }

  if (spec.policy === 'rehit' && !isSoundSeconds(spec.cooldown, true)) {
    return 'rehits after a cooldown of a finite number of seconds from 0.';
  }

  const limits = [spec.pierce, spec.budget];

  return limits.every((limit) => limit === undefined || (Number.isInteger(limit) && limit >= 1))
    ? undefined
    : 'pierces and budgets a whole number from 1.';
};

/** Checks the ledgers, and that every catch names one the kind declares. */
const checkLedgers = <G extends AreaTriggerTypes>(name: string, def: AnyAreaTriggerDef<G>): void => {
  const ledgers = def.ledgers ?? {};

  for (const [ledger, spec] of Object.entries(ledgers)) {
    const problem = ledgerProblem(spec);

    if (problem !== undefined) {
      fail(name, `its ledger ${ledger} ${problem}`);
    }
  }

  const named = [def.contact?.ledger, def.land?.ledger, ...(def.every ?? []).map((pulse) => pulse.ledger)];
  const unknown = named.find((ledger) => ledger !== undefined && !Object.hasOwn(ledgers, ledger));

  if (unknown !== undefined) {
    fail(name, `a catch records in ledger ${unknown}, which it does not declare.`);
  }
};

/** Checks its area auras: a mode, a linger for a refresh, whole stacks. */
const checkAuras = <G extends AreaTriggerTypes>(name: string, def: AnyAreaTriggerDef<G>): void => {
  for (const [index, spec] of (def.auras ?? []).entries()) {
    const isRefresh = spec.mode === 'refresh';

    if (!isOneOf(spec.mode, ['enter-exit', 'refresh']) || (isRefresh && !isSoundSeconds(spec.linger))) {
      fail(name, `its aura ${index} is kept on enter and exit, or refreshed with a linger of seconds above 0.`);
    }

    if (spec.stacks !== undefined && !(Number.isInteger(spec.stacks) && spec.stacks >= 1)) {
      fail(name, `its aura ${index} adds a whole number of stacks from 1.`);
    }
  }
};

/** Checks the tags and the hooks. */
const checkTagsAndHooks = <G extends AreaTriggerTypes>(
  name: string,
  def: AnyAreaTriggerDef<G>,
  tags: AreaTagTable<G['areaTag']>,
): void => {
  const tagIds: Readonly<Record<string, number | undefined>> = tags.id;
  const unknown = (def.tags ?? []).find((tag) => tagIds[tag] === undefined);

  if (unknown !== undefined) {
    fail(name, `unknown area trigger tag ${unknown}.`);
  }

  const notFunction = HOOK_FIELDS.find((hook) => def[hook] !== undefined && typeof def[hook] !== 'function');

  if (notFunction !== undefined) {
    fail(name, `${notFunction} must be a function.`);
  }

  const cues: readonly unknown[] = Object.values(def.cues ?? {});

  if (cues.some((cue) => typeof cue !== 'function')) {
    fail(name, 'every cue is a function.');
  }
};

/**
 * Checks one area trigger kind at load, throwing a `RangeError` naming it: its shape, lifetime, modes, bound, limit,
 * frame order, contact, pulses, tags and hooks. Its tick slot and owner aura are checked against the system's slots
 * and auras when it is built.
 */
export const checkAreaTrigger = <G extends AreaTriggerTypes>(
  name: string,
  def: AnyAreaTriggerDef<G>,
  tags: AreaTagTable<G['areaTag']>,
): void => {
  checkShapeAndLifetime(name, def);
  checkModes(name, def);
  checkBound(name, def);
  checkLimit(name, def);
  checkFrame(name, def);
  checkPulse(name, def.every);
  checkLedgers(name, def);
  checkAuras(name, def);
  checkTagsAndHooks(name, def, tags);
};
