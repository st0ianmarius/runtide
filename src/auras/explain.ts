import { explainModifiers, type ModifierExplanation } from '../modifiers/index.ts';
import type { AuraMerge, AuraStacking } from './aura-def.ts';
import type { AuraId, AuraTagId, AuraTypes } from './aura-types.ts';
import {
  CUSTOM_MERGE,
  CUSTOM_STACKING,
  KEEP_DEPLETED,
  MERGES,
  OWNER_ONLY,
  PARTY_ONLY,
  PER_SOURCE,
  STACKINGS
} from './define-auras.ts';
import type { AuraEngine } from './engine.ts';

/**
 * An aura explained as data: its rules, tags and modifiers at a stack count, with every number the
 * simulation uses. The client phrases it (a tooltip, a card) in its own words; nothing here is text.
 */
export interface AuraExplanation {
  /** The discriminant. */
  readonly kind: 'aura';

  /** The aura. */
  readonly aura: AuraId;

  /** The stacks the explanation is for. */
  readonly stacks: number;

  /** Its own length in seconds; `'infinite'`, `'live'` for a length read at each application, `'given'` for none. */
  readonly duration: number | 'infinite' | 'live' | 'given';

  /** The id of the clock its lifetime counts on. */
  readonly clock: number;

  /** Its stacking rule; `'custom'` for the game's own. */
  readonly stacking: AuraStacking | 'custom';

  /** Its most stacks. */
  readonly maxStacks: number;

  /** Whether each source keeps its own instance. */
  readonly isPerSource: boolean;

  /** Its value merge; `'custom'` for the game's own. */
  readonly merge: AuraMerge | 'custom';

  /** The value a fresh instance starts with. */
  readonly value: number;

  /** Whether it stays when its value is spent. */
  readonly keepsWhenDepleted: boolean;

  /** Who sees it on the wire. */
  readonly audience: 'owner' | 'party' | 'all';

  /** The tags it grants. */
  readonly tags: readonly AuraTagId[];

  /** The tags that turn it away. */
  readonly blockedBy: readonly AuraTagId[];

  /** The tags it cleanses. */
  readonly removes: readonly AuraTagId[];

  /** Its modifiers explained at `stacks`, in order. */
  readonly modifiers: readonly ModifierExplanation[];

  /** Its beat: seconds between beats (`'live'` when read from stats) and the beat's clock. */
  readonly periodic:
    | {
        /** Seconds between beats. */
        readonly every: number | 'live';

        /** The id of the clock its beats count on: `periodic.clock`, or the aura's own when that is absent. */
        readonly clock: number;
      }
    | undefined;
}

/** The explained form of a definition's own length. */
const durationOf = (duration: unknown): AuraExplanation['duration'] => {
  if (typeof duration === 'number' || duration === 'infinite') {
    return duration;
  }

  return typeof duration === 'function' ? 'live' : 'given';
};

/** The rules part of an explanation: stacking, merge and flags. */
const rulesOf = <G extends AuraTypes>(engine: AuraEngine<G>, id: AuraId) => {
  const flags = engine.flags[id] ?? 0;
  const stacking = engine.stacking[id] ?? 0;
  const merge = engine.merge[id] ?? 0;

  return {
    stacking: stacking === CUSTOM_STACKING ? ('custom' as const) : (STACKINGS[stacking] ?? 'refresh'),
    maxStacks: engine.maxStacks[id] ?? 1,
    isPerSource: (flags & PER_SOURCE) !== 0,
    merge: merge === CUSTOM_MERGE ? ('custom' as const) : (MERGES[merge] ?? 'replace'),
    keepsWhenDepleted: (flags & KEEP_DEPLETED) !== 0,
    audience: auraAudience(flags)
  };
};

/** Who sees an aura of these flags. */
const auraAudience = (flags: number): 'owner' | 'party' | 'all' => {
  if ((flags & OWNER_ONLY) !== 0) {
    return 'owner';
  }

  return (flags & PARTY_ONLY) === 0 ? 'all' : 'party';
};

/** The tags part of an explanation. */
const tagsOf = <G extends AuraTypes>(engine: AuraEngine<G>, id: AuraId) => ({
  tags: engine.tables.tagIds[id] ?? [],
  blockedBy: engine.tables.blockedByIds[id] ?? [],
  removes: engine.tables.removes[id] ?? []
});

/** The beat part of an explanation. */
const periodicOf = <G extends AuraTypes>(engine: AuraEngine<G>, id: AuraId): AuraExplanation['periodic'] => {
  const every = engine.registry.get(id).periodic?.every;

  if (every === undefined) {
    return undefined;
  }

  return {
    every: typeof every === 'function' ? 'live' : every,
    clock: engine.tables.beatClock[id] ?? 0
  };
};

/** Explains an aura of an engine's registry at `stacks` stacks. */
export const explainIn = <G extends AuraTypes>(engine: AuraEngine<G>, id: AuraId, stacks: number): AuraExplanation => {
  const def = engine.registry.get(id);
  const list = engine.tables.lists[id];

  return {
    kind: 'aura',
    aura: id,
    stacks,
    duration: durationOf(def.duration),
    clock: engine.tables.clock[id] ?? 0,
    ...rulesOf(engine, id),
    value: def.value ?? 0,
    ...tagsOf(engine, id),
    modifiers: list === undefined ? [] : explainModifiers(list, stacks),
    periodic: periodicOf(engine, id)
  };
};
