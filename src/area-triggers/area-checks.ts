import type { AnyAreaTriggerDef } from './area-def.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaTagTable } from './tags.ts';

/** The hooks a definition may carry, each a function when present. */
const HOOK_FIELDS = ['state', 'init', 'move', 'frame', 'onExpire', 'onEnd'] as const;

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

  if (!isOneOf(def.insert, ['after-parent'])) {
    fail(name, "its insert is 'after-parent' when present.");
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

  if (!isOneOf(bound.owner, ['present', 'standing']) || !isOneOf(bound.whileDown, ['end', 'suspend'])) {
    fail(name, "its bound's owner is 'present' or 'standing', and whileDown 'end' or 'suspend'.");
  }

  if (bound.whileDown === 'suspend' && bound.owner !== 'standing') {
    fail(name, "it suspends while its owner is down only with a bound owner of 'standing'.");
  }

  if (!isOneOf(bound.cue, ['fade', 'silent']) || (bound.when !== undefined && typeof bound.when !== 'function')) {
    fail(name, "its bound's cue is 'fade' or 'silent', and when a function.");
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

  if (!isOneOf(limit.replace, ['oldest', 'silent', 'refuse'])) {
    fail(name, "its limit replaces 'oldest', 'silent' or 'refuse'.");
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
 * tags and hooks. Its tick slot and owner aura are checked against the system's slots and auras when it is built.
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
  checkTagsAndHooks(name, def, tags);
};
