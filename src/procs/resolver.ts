import type { AuraId, AuraSystem, AuraTagId } from '../auras/index.ts';
import { ownValue } from '../core/records.ts';
import type { CueId, CueRegistry } from '../cues/index.ts';
import { checkTarget } from './apply.ts';
import type { Proc } from './proc-data.ts';
import type { ProcResolver, ProcService } from './proc-kind.ts';
import type { ProcTypes } from './proc-types.ts';
import type { ProcRegistry } from './registry.ts';

/** What resolvers are built from. */
export interface ResolverParts<G extends ProcTypes> {
  /** The aura system, whose registry and tags name auras and tags. */
  readonly auras: AuraSystem<G>;

  /** The proc registry, for nested lists. */
  readonly kinds: ProcRegistry<G>;

  /** The resource names, by id. */
  readonly resources: readonly string[];

  /** The cue registry of the system's buffer, if it has one. */
  readonly cues: CueRegistry | undefined;

  /** The services the system and its host have: `party` and `grant` on the host, the system's `bus`. */
  readonly services: ReadonlySet<ProcService>;

  /** Whether a chance between 0 and 1 can roll: the system has a random stream or a chance rule. */
  readonly canRoll: boolean;

  /** Notes a hatch name for the escape report. */
  readonly noteHatch: (name: string) => void;
}

/** Throws a `RangeError` with a message, prefixed with what was being read when there is one. */
const fail = (what: string | undefined, message: string): never => {
  throw new RangeError(what === undefined ? message : `${what}: ${message}`);
};

/** What a missing service's refusal says. */
const NEEDS: Readonly<Record<ProcService, string>> = {
  party: 'a party target needs the proc host to have a party service.',
  grant: 'a grant proc needs the proc host to have a grant service.',
  bus: 'an event proc needs the proc system to have a bus.'
};

/** Throws unless a chance is in (0, 1], and one that rolls has something to roll on. */
const checkChance = <G extends ProcTypes>(parts: ResolverParts<G>, chance: number | undefined): void => {
  if (chance === undefined) {
    return;
  }

  if (!(chance > 0 && chance <= 1)) {
    throw new RangeError(`a proc's chance must be in (0, 1]; got ${chance}.`);
  }

  if (chance < 1 && !parts.canRoll) {
    throw new RangeError(`a chance of ${chance} needs the proc system to have a random stream or a rollChance rule.`);
  }
};

/**
 * Resolves a nested list at load: each proc's chance checked, its kind known, its names resolved, its target one the
 * runner knows, and the services it needs present.
 */
const prepareList = <G extends ProcTypes>(
  parts: ResolverParts<G>,
  procs: readonly Proc<G>[],
  resolve: ProcResolver<G>
): readonly Proc<G>[] =>
  Object.freeze(
    procs.map((proc) => {
      checkChance(parts, proc.chance);

      const kind = parts.kinds.defs[parts.kinds.kindOf(proc)];
      const prepared = kind?.prepare?.(proc, resolve) ?? proc;
      const to = kind?.targetOf?.(prepared);

      checkTarget(to);

      if (to === 'party') {
        resolve.need('party');
      }

      return prepared;
    })
  );

/** An aura id checked against the registry at load: a live id, not a tombstone or a number outside it. */
const checkedAura = <G extends ProcTypes>(auras: AuraSystem<G>, id: AuraId, what: string | undefined): AuraId => {
  if (!Number.isInteger(id) || id < 0 || id >= auras.registry.size || auras.registry.isRetired(id)) {
    fail(what, `${id} is not a live aura id.`);
  }

  return id;
};

/** A cue id checked against the registry at load: a live id, not a tombstone or a number outside it. */
const checkedCue = (cues: CueRegistry, id: CueId, what: string | undefined): CueId =>
  cues.schemas[id] === undefined ? fail(what, `${id} is not a live cue id.`) : id;

/**
 * A resolver over a system's tables. With `what` (at load) every id is checked and every error names what was being
 * prepared; without it (when a proc applies) ids pass through as they are and names are looked up.
 */
export const createResolver = <G extends ProcTypes>(
  parts: ResolverParts<G>,
  what: string | undefined
): ProcResolver<G> => {
  const auraIds: Readonly<Record<string, AuraId | undefined>> = parts.auras.registry.id;
  const tagIds: Readonly<Record<string, AuraTagId | undefined>> = parts.auras.tags.id;
  const isChecked = what !== undefined;

  const resolve: ProcResolver<G> = {
    aura: (aura) => {
      if (typeof aura !== 'string') {
        return isChecked ? checkedAura(parts.auras, aura, what) : aura;
      }

      return ownValue(auraIds, aura) ?? fail(what, `unknown aura ${aura}.`);
    },

    tag: (tag) => {
      if (typeof tag !== 'string') {
        return isChecked && !(Number.isInteger(tag) && tag >= 0 && tag < parts.auras.tags.size)
          ? fail(what, `${tag} is not a tag id.`)
          : tag;
      }

      return ownValue(tagIds, tag) ?? fail(what, `unknown aura tag ${tag}.`);
    },

    cue: (cue) => {
      const cues = parts.cues ?? fail(what, 'a cue proc needs the proc system to have cues.');

      if (typeof cue !== 'string') {
        return isChecked ? checkedCue(cues, cue, what) : cue;
      }

      const ids: Readonly<Record<string, CueId | undefined>> = cues.id;

      return ownValue(ids, cue) ?? fail(what, `unknown cue ${cue}.`);
    },

    cues: () => parts.cues ?? fail(what, 'a cue proc needs the proc system to have cues.'),

    resource: (resource) => {
      const id = typeof resource === 'number' ? resource : parts.resources.indexOf(resource);

      return Number.isInteger(id) && id >= 0 && id < parts.resources.length
        ? id
        : fail(what, `unknown resource ${resource}.`);
    },

    procs: (procs) => prepareList(parts, procs, resolve),
    hatch: parts.noteHatch,
    isIndependent: (aura) => parts.auras.registry.get(aura).stacking === 'independent',

    need: (service) => {
      if (!parts.services.has(service)) {
        fail(what, NEEDS[service]);
      }
    }
  };

  return resolve;
};

/** Prepares a list at load (`procs.prepare`), every error naming `what`. */
export const prepareProcs = <G extends ProcTypes>(
  parts: ResolverParts<G>,
  procs: readonly Proc<G>[],
  what: string
): readonly Proc<G>[] => {
  try {
    return prepareList(parts, procs, createResolver(parts, what));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    throw new RangeError(message.startsWith(`${what}:`) ? message : `${what}: ${message}`, {
      cause: error
    });
  }
};
