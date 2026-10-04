import type { AuraId, AuraSystem, AuraTagId, AuraTypes } from '../auras/index.ts';
import { compileCondition, type ConditionTables, isMirrorSafe } from '../conditions/index.ts';

/**
 * What the shared motion step reads beyond the presses, by the game's names: auras, aura tags and stats, the reads of
 * its mirror-safe hooks (`activate`, `checkCast`) included, since only what is declared here is held predicted.
 */
export interface MotionReads<G extends AuraTypes> {
  /** Auras it reads by id (a knockback guard, a dodge's own state). */
  readonly auras?: readonly AuraId[];

  /** Tags it reads (a root, a stun). */
  readonly tags?: readonly G['tag'][];

  /** Stats it folds (a move speed): every aura with a modifier on one of them is read. */
  readonly stats?: readonly G['stat'][];

  /**
   * The clocks the mirror ticks, by name. When given, every aura the mirror reads whose own clock is not among them is
   * reported `frozen`: the mirror never counts it down, so it holds still between two acks (a cooldown on the default
   * `world` clock that a motion-only mirror never ticks).
   */
  readonly clocks?: readonly G['clock'][];
}

/** What the predicted rule is checked over. */
export interface PredictedRuleOptions<G extends AuraTypes> {
  /** The aura system whose registry is checked. */
  readonly auras: AuraSystem<G>;

  /** The ability system, whose presses read their slots' cooldowns, costs and tags. */
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

  /**
   * The game's condition and value tables, when aura modifiers wait on conditions: a predicted aura's conditions must
   * then be mirror-safe, or the mirror would fold its modifiers by a guess.
   */
  readonly conditions?: ConditionTables;
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

/** The predicted rule checked both ways. */
export interface PredictedReport {
  /** Auras the mirror reads that are not `predicted`: the mirror would miss them. Empty when the rule holds. */
  readonly unpredicted: readonly UnpredictedRead[];

  /** `predicted` auras nothing the mirror runs reads: they cost the wire for nothing. */
  readonly unread: readonly AuraId[];

  /** `predicted` auras with a modifier whose condition is not mirror-safe (checked when `conditions` is given). */
  readonly unsafe: readonly AuraId[];

  /**
   * `predicted` auras a seed cannot put back as the mirror would land them: one with an `onLand` hook, whose payload
   * (its game fields) the wire does not carry.
   */
  readonly unseedable: readonly AuraId[];

  /**
   * `predicted` auras with an `add` or `min` modifier on a stat the motion step folds: a split fold (the wire's stats
   * folded without the predicted auras, the mirror multiplying its own in) is exact only for multipliers, so these
   * drift unless the mirror folds the whole stat itself.
   */
  readonly inexact: readonly AuraId[];

  /**
   * Auras the mirror reads (by id, a read tag or a folded stat) whose own clock (`clock`, else the system's first) is
   * not one the mirror ticks (`motion.clocks`): their time left freezes on the mirror between acks, so a read of one
   * (a cooldown's end, a root's) is stale until the next seed. Empty when `motion.clocks` is absent.
   */
  readonly frozen: readonly AuraId[];
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
  stats: new Set<string>(options.motion?.stats ?? [])
});

/** Why the mirror reads an aura, or `undefined` when it does not. */
const reasonOf = <G extends AuraTypes>(
  options: PredictedRuleOptions<G>,
  [aura, reads]: readonly [AuraId, ReturnType<typeof readsOf>]
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

/** Whether a predicted aura's modifiers all wait on mirror-safe conditions, or on none. */
const isSafeAura = <G extends AuraTypes>(tables: ConditionTables, def: ReturnType<AuraSystem<G>['registry']['get']>) =>
  (def.modifiers ?? []).every(
    (modifier) => modifier.when === undefined || isMirrorSafe(tables, compileCondition(tables, modifier.when))
  );

/** The predicted auras whose modifiers wait on a condition the mirror may not evaluate. */
const unsafeOf = <G extends AuraTypes>(options: PredictedRuleOptions<G>): AuraId[] => {
  const { auras, conditions } = options;
  const { registry } = auras;

  return conditions === undefined
    ? []
    : registry.ids.filter(
        (aura) => !registry.isRetired(aura) && auras.isPredicted(aura) && !isSafeAura(conditions, registry.get(aura))
      );
};

/**
 * Checks the predicted rule over a game's auras, both ways: every aura the prediction mirror reads (the
 * presses' cooldowns and costs, an aura granting a tag a press or the motion step reads, an aura with a
 * modifier on a stat the motion step folds, an aura the motion step names) must be `predicted`, and a `predicted` aura
 * nothing reads is reported as unread; with the condition tables, a predicted aura whose modifiers wait on a condition
 * that is not mirror-safe is reported as unsafe. An aura a press lands is not a read: a mirror lands only the predicted
 * ones, and one the mirror depends on is read through a tag or a declared motion read. Given the clocks the mirror ticks
 * (`motion.clocks`), an aura it reads on any other clock is reported as frozen. A game runs it in its tests over its
 * registries.
 */
export const checkPredicted = <G extends AuraTypes>(options: PredictedRuleOptions<G>): PredictedReport => {
  const { auras } = options;
  const reads = readsOf(options);
  const ticked = tickedClocksOf(options);
  const unpredicted: UnpredictedRead[] = [];
  const unread: AuraId[] = [];
  const frozen: AuraId[] = [];

  for (const aura of auras.registry.ids) {
    const reason = auras.registry.isRetired(aura) ? undefined : reasonOf(options, [aura, reads]);
    const isPredicted = auras.isPredicted(aura);

    if (reason !== undefined && !isPredicted) {
      unpredicted.push({ aura, reason });
    } else if (reason === undefined && isPredicted) {
      unread.push(aura);
    }

    if (reason !== undefined && ticked !== undefined && !ticked.has(clockOf(options, aura))) {
      frozen.push(aura);
    }
  }

  return { unpredicted, unread, unsafe: unsafeOf(options), ...seedReport(options), frozen };
};

/** The names of the clocks the mirror ticks, checked against the system's; `undefined` when the game names none. */
const tickedClocksOf = <G extends AuraTypes>(options: PredictedRuleOptions<G>): Set<string> | undefined => {
  const clocks = options.motion?.clocks;

  if (clocks === undefined) {
    return undefined;
  }

  const known = new Set<string>(options.auras.clockTable.names);

  for (const name of clocks) {
    if (!known.has(name)) {
      throw new RangeError(`checkPredicted: there is no aura clock named ${name}.`);
    }
  }

  return new Set<string>(clocks);
};

/** The name of the clock an aura's lifetime counts on: its own, else the system's first. */
const clockOf = <G extends AuraTypes>(options: PredictedRuleOptions<G>, aura: AuraId): string => {
  const { auras } = options;

  return auras.registry.get(aura).clock ?? auras.clockTable.names[0] ?? '';
};

/** The predicted auras a seed cannot rebuild, and those a split fold of the motion stats would fold inexactly. */
const seedReport = <G extends AuraTypes>(
  options: PredictedRuleOptions<G>
): Pick<PredictedReport, 'unseedable' | 'inexact'> => {
  const { auras } = options;
  const { registry } = auras;
  const stats = new Set<string>(options.motion?.stats ?? []);

  const predicted = registry.ids.filter((aura) => !registry.isRetired(aura) && auras.isPredicted(aura));

  return {
    unseedable: predicted.filter((aura) => registry.get(aura).onLand !== undefined),
    inexact: predicted.filter((aura) =>
      (registry.get(aura).modifiers ?? []).some((modifier) => modifier.op !== 'mul' && stats.has(modifier.stat))
    )
  };
};
