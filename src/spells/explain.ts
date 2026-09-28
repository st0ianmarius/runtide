import { toId } from '../core/ids.ts';
import {
  evaluateScaled,
  explainScaled,
  type ScaledExplanation,
  type StatId,
  type StatView,
} from '../modifiers/index.ts';
import type { ActivationKindDef } from './activation.ts';
import { StatsCall } from './cast.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { ActivationKindId, ActivationShape, SpellId, SpellTagId, SpellTypes } from './spell-types.ts';
import { baseView } from './stats-box.ts';

/** How a preview or an explanation reads a spell: at which rank and variant, with whose stats. */
export interface PreviewOptions<G extends SpellTypes> {
  /** The rank, from 1; 1 when absent. */
  readonly rank?: number;

  /** The variant; 0 when absent. */
  readonly variant?: number;

  /** The caster a `stats` function reads, if any; a preview has no world, so it is usually absent. */
  readonly caster?: G['bearer'];

  /** The caster's stats; the stat table's bases when absent. */
  readonly view?: StatView;

  /** A target's stats, which finish the target terms; without them, target terms are left out. */
  readonly target?: StatView;
}

/** One entry of a spell's stats, explained: its key, and its scaled value explained (or the number a function gave). */
export interface SpellStatExplanation {
  /** The stats table's key: a developer identifier, which the client maps to its own words. */
  readonly key: string;

  /** The value explained as data, for a table; its number, for a `stats` function's number. */
  readonly value: ScaledExplanation | number;
}

/**
 * A spell explained as data (§I.5.3, §II.6 M6): its tags, activation, stats at a rank, outgoing shares and timeline,
 * with the numbers the simulation uses, for the client to phrase. Nothing here is text.
 */
export interface SpellExplanation {
  /** The discriminant. */
  readonly kind: 'spell';

  /** The spell. */
  readonly spell: SpellId;

  /** The rank explained. */
  readonly rank: number;

  /** Its tags. */
  readonly tags: readonly SpellTagId[];

  /** Its activation kind and that kind's numbers (the kind's `explain`, else the activation's own numeric fields). */
  readonly activation: {
    /** The kind. */
    readonly kind: ActivationKindId;

    /** Its numbers, by field. */
    readonly values: Readonly<Record<string, number>>;
  };

  /** Its stats, in declaration order: each table value explained, or each number a `stats` function returned. */
  readonly stats: readonly SpellStatExplanation[];

  /** Its shares of the outgoing multiplier stats, in stat order; a stat it leaves out takes a share of 1. */
  readonly scaling: readonly {
    /** The stat. */
    readonly stat: StatId;

    /** The share. */
    readonly share: number;
  }[];

  /**
   * Each stage's seconds: a constant, `'cast'` for seconds read per cast (a function), `undefined` for a stage it
   * does not have; and the channel's beat (0 for every step).
   */
  readonly timeline: {
    /** The windup. */
    readonly windup: number | 'cast' | undefined;

    /** The channel. */
    readonly channel: number | 'cast' | undefined;

    /** The channel's beat. */
    readonly every: number;

    /** The recovery. */
    readonly recover: number | 'cast' | undefined;
  };
}

/** The view a preview reads: the given one, else the stat table's bases. */
const viewOf = <G extends SpellTypes>(registry: SpellRegistry<G>, options: PreviewOptions<G>): StatView =>
  options.view ?? baseView(registry.stats);

/**
 * A spell's stats as a cast at a rank would take them (§II.6 M6), with no world: a table's values evaluated against
 * the given stats (the stat table's bases by default) and a target's when given (else target terms are left out), or
 * what a `stats` function returns for the rank and variant. A new object, for the client's previews and tooltips.
 */
export const previewStats = <G extends SpellTypes>(
  registry: SpellRegistry<G>,
  spell: SpellId,
  options: PreviewOptions<G> = {},
): Readonly<Record<string, unknown>> => {
  const def = registry.get(spell);
  const compiled = registry.compiled[spell];
  const view = viewOf(registry, options);
  const rank = options.rank ?? 1;

  if (compiled !== undefined) {
    return Object.fromEntries(
      compiled.keys.map((key, index) => {
        const value = compiled.values[index];

        return [key, value === undefined ? 0 : evaluateScaled(value, { caster: view, target: options.target, rank })];
      }),
    );
  }

  if (typeof def.stats !== 'function') {
    return {};
  }

  const call = new StatsCall<G>();

  call.caster = options.caster;
  call.spell = spell;
  call.rank = rank;
  call.variant = options.variant ?? 0;
  call.view = view;

  return def.stats(call);
};

/** The numbers of an activation: its kind's `explain`, else its own numeric fields. */
const activationValues = <G extends SpellTypes>(
  kind: ActivationKindDef<ActivationShape, G> | undefined,
  activation: ActivationShape,
): Readonly<Record<string, number>> =>
  kind?.explain?.(activation) ??
  Object.fromEntries(
    Object.entries(activation).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  );

/** A stage's column entry as explained: its constant, `'cast'` for NaN, `undefined` for 0 when it has no stage. */
const stageOf = (seconds: number | undefined, hasStage: boolean): number | 'cast' | undefined => {
  if (!hasStage) {
    return undefined;
  }

  return seconds === undefined || Number.isNaN(seconds) ? 'cast' : seconds;
};

/** A spell's stats explained: each table value explained at the rank, or each number a `stats` function returned. */
const statsOf = <G extends SpellTypes>(
  registry: SpellRegistry<G>,
  spell: SpellId,
  options: PreviewOptions<G>,
): readonly SpellStatExplanation[] => {
  const compiled = registry.compiled[spell];
  const view = viewOf(registry, options);

  if (compiled !== undefined) {
    return compiled.keys.map((key, index) => {
      const value = compiled.values[index];

      return {
        key,
        value:
          value === undefined ? 0 : explainScaled(value, options.rank ?? 1, { caster: view, target: options.target }),
      };
    });
  }

  return Object.entries(previewStats(registry, spell, options)).flatMap(([key, value]) =>
    typeof value === 'number' ? [{ key, value }] : [],
  );
};

/** A spell's outgoing shares, in stat order: the stats it names. */
const scalingOf = <G extends SpellTypes>(registry: SpellRegistry<G>, spell: SpellId): SpellExplanation['scaling'] => {
  const shares = registry.shares[spell];

  if (shares === undefined || registry.stats === undefined) {
    return [];
  }

  return registry.stats.ids.flatMap((stat) => {
    const share = shares[stat];

    return share === undefined || Number.isNaN(share) ? [] : [{ stat, share }];
  });
};

/** A spell's stages, from its columns: their constants, `'cast'` for a function, `undefined` for none. */
const timelineOf = <G extends SpellTypes>(registry: SpellRegistry<G>, spell: SpellId): SpellExplanation['timeline'] => {
  const { columns } = registry;
  const { timeline } = registry.get(spell);
  const windup = columns.windup[spell] ?? 0;
  const recover = columns.recover[spell] ?? 0;

  return {
    windup: stageOf(windup, windup !== 0 || timeline?.windup !== undefined),
    channel: stageOf(columns.channel[spell], timeline?.channel !== undefined),
    every: columns.every[spell] ?? 0,
    recover: stageOf(recover, recover !== 0 || timeline?.recover !== undefined),
  };
};

/**
 * A spell explained as data (§I.5.3, §II.6 M6), at a rank (1 by default) and with the given stats (the stat table's
 * bases by default): its tags, activation kind and numbers, stats, outgoing shares and timeline. The client phrases
 * it in its own words; the numbers are the simulation's.
 */
export const explainSpell = <G extends SpellTypes>(
  registry: SpellRegistry<G>,
  spell: SpellId,
  options: PreviewOptions<G> = {},
): SpellExplanation => {
  const def = registry.get(spell);
  const kind = toId<'activations'>(registry.columns.activation[spell] ?? 0);

  return {
    kind: 'spell',
    spell,
    rank: options.rank ?? 1,
    tags: (registry.tagSets[spell]?.toArray() ?? []).map((tag) => toId<'spellTags'>(tag)),
    activation: { kind, values: activationValues(registry.activations.defs[kind], def.activation) },
    stats: statsOf(registry, spell, options),
    scaling: scalingOf(registry, spell),
    timeline: timelineOf(registry, spell),
  };
};
