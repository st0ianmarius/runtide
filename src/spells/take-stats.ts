import { isAuto } from './activation.ts';
import { type Cast, NO_SCALED, NO_STATS } from './cast.ts';
import { LIVE, STATS_FUNCTION, STATS_TABLE } from './define-spells.ts';
import type { SpellEngine } from './engine.ts';
import type { AnySpellDef } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';
import { takeTable } from './stats-box.ts';

/**
 * Takes a cast's stats (decision 2): a stats table's values snapshotted from the caster's stats for the
 * spell (`host.statsOf`, else the stat table's bases) into the cast's box, a `stats` function called with the caster,
 * rank and view, or none. Called once at the start, and again before every hook of a `live` spell.
 */
export const takeStats = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): void => {
  cast.hasStats = true;

  const flags = engine.registry.columns.flags[cast.spell] ?? 0;

  if ((flags & (STATS_TABLE | STATS_FUNCTION)) === 0) {
    cast.stats = NO_STATS;
    cast.scaled = NO_SCALED;

    return;
  }

  const view = engine.host.statsOf?.(cast.caster, cast.spell) ?? engine.baseView;
  const compiled = engine.registry.compiled[cast.spell];

  if (compiled !== undefined) {
    const box = (cast.box ??= engine.boxes.take(cast.spell));

    const ctx = engine.tableCall;

    ctx.caster = view;
    ctx.rank = cast.rank;
    takeTable(box, compiled, ctx);
    cast.stats = box.stats;
    cast.scaled = box.scaled;

    return;
  }

  const { stats } = def;
  const call = engine.statsCall;

  call.caster = cast.caster;
  call.spell = cast.spell;
  call.rank = cast.rank;
  call.view = view;
  cast.stats = typeof stats === 'function' ? stats(call) : NO_STATS;
  cast.scaled = NO_SCALED;
  call.caster = undefined;
};

/** Takes a `live` spell's stats again, before a hook; nothing for a snapshot spell. */
export const refreshLive = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): void => {
  if (((engine.registry.columns.flags[cast.spell] ?? 0) & LIVE) !== 0) {
    takeStats(engine, cast, def);
  }
};

/**
 * An `auto` spell's interval read at its cast: its seconds, or its function of the cast (the stats taken
 * first when a gate refused the cast before they were). NaN for any other spell. Throws unless it is above 0.
 */
export const autoIntervalOf = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  def: AnySpellDef<G>
): number => {
  const { activation } = def;

  if (!isAuto(activation)) {
    return Number.NaN;
  }

  const { interval } = activation;

  if (typeof interval === 'number') {
    return interval;
  }

  if (!cast.hasStats) {
    takeStats(engine, cast, def);
  }

  const seconds = interval(cast);

  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    throw new RangeError(
      `Spell ${engine.registry.name(cast.spell)}: an auto interval must be above 0; got ${seconds}.`
    );
  }

  return seconds;
};
