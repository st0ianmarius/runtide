import { type Cast, NO_SCALED, NO_STATS } from './cast.ts';
import { LIVE, STATS_FUNCTION, STATS_TABLE } from './define-spells.ts';
import type { SpellEngine } from './engine.ts';
import type { AnySpellDef } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';
import { takeTable } from './stats-box.ts';

/**
 * Takes a cast's stats (§II.3.13, decision 2): a stats table's values snapshotted from the caster's stats for the
 * spell (`host.statsOf`, else the stat table's bases) into the cast's box, a `stats` function called with the caster,
 * rank, variant and view, or none. Called once at the start, and again before every hook of a `live` spell.
 */
export const takeStats = <G extends SpellTypes>(engine: SpellEngine<G>, cast: Cast<G>, def: AnySpellDef<G>): void => {
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

    takeTable(box, compiled, { caster: view, rank: cast.rank });
    cast.stats = box.stats;
    cast.scaled = box.scaled;

    return;
  }

  const { stats } = def;
  const call = engine.statsCall;

  call.caster = cast.caster;
  call.spell = cast.spell;
  call.rank = cast.rank;
  call.variant = cast.variant;
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
