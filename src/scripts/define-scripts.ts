import { toId } from '../core/ids.ts';
import { deepFreeze } from '../core/records.ts';
import type { AnyBehaviour, ScriptId, ScriptTypes } from './script-types.ts';

/** One script as the system runs it: its behaviours, and which of them handle each moment and event. */
export interface CompiledScript<G extends ScriptTypes> {
  /** Its key in the registry, for error messages. */
  readonly key: string;

  /** Its behaviours, in order. */
  readonly behaviours: readonly AnyBehaviour<G>[];

  /** The behaviours with a `spawn` handler, by index. */
  readonly spawn: readonly number[];

  /** The behaviours with a `tick` handler, by index. */
  readonly tick: readonly number[];

  /** The behaviours with a `timer` handler, by index. */
  readonly timer: readonly number[];

  /** The behaviours handling each event, by event name and index. */
  readonly on: ReadonlyMap<string, readonly number[]>;
}

/** The game's scripts: ids by key order, each compiled once. */
export interface ScriptRegistry<G extends ScriptTypes, Name extends string = string> {
  /** The names, in id order. */
  readonly names: readonly Name[];

  /** Each name's id. */
  readonly id: Readonly<Record<Name, ScriptId>>;

  /** Each script, compiled, by id. */
  readonly scripts: readonly CompiledScript<G>[];

  /** The events any script handles, in the order first handled. */
  readonly events: readonly string[];
}

/** What a script registry is built with, beyond its scripts. */
export interface ScriptRegistryOptions {
  /** Whether to deep-freeze every behaviour, to catch mutation; true by default, off in a production build. */
  readonly freeze?: boolean;
}

/** The indexes of the behaviours that declare a handler. */
const having = <G extends ScriptTypes>(
  behaviours: readonly AnyBehaviour<G>[],
  has: (behaviour: AnyBehaviour<G>) => boolean,
): readonly number[] => Object.freeze(behaviours.flatMap((behaviour, index) => (has(behaviour) ? [index] : [])));

/** Throws unless every handler a behaviour declares is a function. */
const checkBehaviour = <G extends ScriptTypes>(behaviour: AnyBehaviour<G>, where: string): void => {
  for (const key of ['state', 'shared', 'spawn', 'tick', 'timer'] as const) {
    if (behaviour[key] !== undefined && typeof behaviour[key] !== 'function') {
      throw new TypeError(`${where}: its ${key} is not a function.`);
    }
  }

  for (const [event, handler] of Object.entries<unknown>(behaviour.on ?? {})) {
    if (typeof handler !== 'function') {
      throw new TypeError(`${where}: its handler of ${event} is not a function.`);
    }
  }
};

/** Compiles one script: its handler lists, its behaviours checked and frozen when asked. */
const compile = <G extends ScriptTypes>(
  name: string,
  behaviours: readonly AnyBehaviour<G>[],
  freeze: boolean,
): CompiledScript<G> => {
  const events = new Set(behaviours.flatMap((behaviour) => Object.keys(behaviour.on ?? {})));

  for (const [index, behaviour] of behaviours.entries()) {
    checkBehaviour(behaviour, `Script ${name}, behaviour ${index}`);

    if (freeze) {
      deepFreeze(behaviour);
    }
  }

  return Object.freeze({
    key: name,
    behaviours: Object.freeze([...behaviours]),
    spawn: having(behaviours, (behaviour) => behaviour.spawn !== undefined),
    tick: having(behaviours, (behaviour) => behaviour.tick !== undefined),
    timer: having(behaviours, (behaviour) => behaviour.timer !== undefined),
    on: new Map(
      [...events].map((event) => [event, having(behaviours, (behaviour) => Object.hasOwn(behaviour.on ?? {}, event))]),
    ),
  });
};

/**
 * Registers the game's scripts, creatures' and the world's, each a list of behaviours, with ids by key order:
 * `defineScripts<Game, 'hordeCaster' | 'warden'>({ hordeCaster: [picking], warden: [picking, phases, raise] })`. Each
 * script's handler lists are built here, so a unit's step runs only the behaviours that declare a handler, and every
 * behaviour is deep-frozen (its per-unit data lives in its `state`, never on it).
 */
export const defineScripts = <G extends ScriptTypes, const Name extends string>(
  scripts: Readonly<Record<Name, readonly AnyBehaviour<G>[]>>,
  options: ScriptRegistryOptions = {},
): ScriptRegistry<G, Name> => {
  const names = Object.keys(scripts).filter((key): key is Name => Object.hasOwn(scripts, key));
  const compiled = names.map((name) => compile(name, scripts[name], options.freeze ?? true));
  const id: Partial<Record<Name, ScriptId>> = {};

  for (const [index, name] of names.entries()) {
    id[name] = toId<'scripts'>(index);
  }

  if (!isComplete(id, names)) {
    throw new Error('A script registry lost a name while it was built.');
  }

  return Object.freeze({
    names: Object.freeze(names),
    id: Object.freeze(id),
    scripts: Object.freeze(compiled),
    events: Object.freeze([...new Set(compiled.flatMap((script) => [...script.on.keys()]))]),
  });
};

/** Whether a record has an id for every name. */
const isComplete = <Name extends string>(
  record: Partial<Record<Name, ScriptId>>,
  names: readonly Name[],
): record is Record<Name, ScriptId> => names.every((name) => record[name] !== undefined);
