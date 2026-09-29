import type { AuraId, AuraSystem, AuraTagId, AuraTypes } from '../auras/index.ts';

/** What the shared motion step reads beyond the presses: auras, aura tags and stats, by the game's names. */
export interface MotionReads<G extends AuraTypes> {
  /** Auras it reads by id (a knockback guard, a dodge's own state). */
  readonly auras?: readonly AuraId[];

  /** Tags it reads (a root, a stun). */
  readonly tags?: readonly G['tag'][];

  /** Stats it folds (a move speed): every aura with a modifier on one of them is read. */
  readonly stats?: readonly G['stat'][];
}

/** What the predicted rule is checked over. */
export interface PredictedRuleOptions<G extends AuraTypes> {
  /** The aura system whose registry is checked. */
  readonly auras: AuraSystem<G>;

  /** The ability system, whose presses read and write their slots' cooldowns, costs, applied auras and tags. */
  readonly abilities?: {
    /** What its presses read and write (`abilities.mirrorReads`). */
    readonly mirrorReads: {
      /** The auras. */
      readonly auras: readonly AuraId[];

      /** The tags. */
      readonly tags: readonly AuraTagId[];
    };
  };

  /** What the game's own motion step reads. */
  readonly motion?: MotionReads<G>;
}

/** Why the mirror reads an aura: by id, through one of its tags, or through a modifier on a stat it folds. */
export type ReadReason = 'aura' | 'tag' | 'stat';

/** An aura the mirror reads that is not `predicted`, and the first reason it is read. */
export interface UnpredictedRead {
  /** The aura. */
  readonly aura: AuraId;

  /** Why it is read. */
  readonly reason: ReadReason;
}

/** The predicted rule checked both ways (§II.6 P7, R3). */
export interface PredictedReport {
  /** Auras the mirror reads that are not `predicted`: the mirror would miss them. Empty when the rule holds. */
  readonly unpredicted: readonly UnpredictedRead[];

  /** `predicted` auras nothing the mirror runs reads: they cost the wire for nothing. */
  readonly unread: readonly AuraId[];
}

/** The names of the tags the mirror reads: the game's motion tags and the presses' tags. */
const readTagsOf = <G extends AuraTypes>(options: PredictedRuleOptions<G>): Set<string> => {
  const { tags } = options.auras;
  const names = new Set<string>(options.abilities?.mirrorReads.tags.map((tag) => tags.name(tag)));
  const known: Readonly<Record<string, AuraTagId | undefined>> = tags.id;

  for (const name of options.motion?.tags ?? []) {
    if (known[name] === undefined) {
      throw new RangeError(`checkPredicted: there is no aura tag named ${name}.`);
    }

    names.add(name);
  }

  return names;
};

/** Everything the mirror reads: auras by id, tags by name, stats by name. */
const readsOf = <G extends AuraTypes>(options: PredictedRuleOptions<G>) => ({
  auras: new Set<number>([...(options.abilities?.mirrorReads.auras ?? []), ...(options.motion?.auras ?? [])]),
  tags: readTagsOf(options),
  stats: new Set<string>(options.motion?.stats ?? []),
});

/** Why the mirror reads an aura, or `undefined` when it does not. */
const reasonOf = <G extends AuraTypes>(
  options: PredictedRuleOptions<G>,
  [aura, reads]: readonly [AuraId, ReturnType<typeof readsOf>],
): ReadReason | undefined => {
  const def = options.auras.registry.get(aura);

  if (reads.auras.has(aura)) {
    return 'aura';
  }

  if ((def.tags ?? []).some((tag) => reads.tags.has(tag))) {
    return 'tag';
  }

  return (def.modifiers ?? []).some((modifier) => reads.stats.has(modifier.stat)) ? 'stat' : undefined;
};

/**
 * Checks the predicted rule over a game's auras (§II.6 P7, R3), both ways: every aura the prediction mirror reads (the
 * presses' cooldowns, costs and applied auras, an aura granting a tag a press or the motion step reads, an aura with a
 * modifier on a stat the motion step folds, an aura the motion step names) must be `predicted`, and a `predicted` aura
 * nothing reads is reported as unread. A game runs it in its tests over its registries.
 */
export const checkPredicted = <G extends AuraTypes>(options: PredictedRuleOptions<G>): PredictedReport => {
  const { auras } = options;
  const reads = readsOf(options);
  const unpredicted: UnpredictedRead[] = [];
  const unread: AuraId[] = [];

  for (const aura of auras.registry.ids) {
    const reason = auras.registry.isRetired(aura) ? undefined : reasonOf(options, [aura, reads]);
    const isPredicted = auras.isPredicted(aura);

    if (reason !== undefined && !isPredicted) {
      unpredicted.push({ aura, reason });
    } else if (reason === undefined && isPredicted) {
      unread.push(aura);
    }
  }

  return { unpredicted, unread };
};
