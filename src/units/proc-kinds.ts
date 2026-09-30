import {
  PROC_LANDED,
  PROC_SKIPPED,
  type ProcContext,
  type ProcKindDef,
  type ProcOutcome,
  procOutcome,
} from '../procs/index.ts';
import { NO_CAST } from '../spells/index.ts';
import { type SpawnUnit, type UnitEngine, unitOf } from './engine.ts';
import type { DespawnProc, DespawnSummonsProc, ReviveProc, SummonProc, UnitProcKinds } from './procs.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/** What the kinds reach: the engine, and the system's own moves. */
export interface UnitKindParts<G extends UnitTypes> {
  /** The engine. */
  readonly engine: UnitEngine<G>;

  /** Spawns a unit, as `units.spawn`. */
  readonly spawn: (template: UnitId, spawn: SpawnUnit<G>) => G['bearer'];

  /** Revives a unit, as `units.revive`. */
  readonly revive: (unit: G['bearer'], health?: number) => boolean;

  /** Despawns a unit with a reason. */
  readonly despawn: (unit: G['bearer'], reason: string) => boolean;
}

/** The outcomes of a proc that did a few things, made once so none allocates one. */
const COUNTED: readonly ProcOutcome[] = Array.from({ length: 17 }, (_unused, amount) =>
  procOutcome('landed', { amount }),
);

/** The outcome of a proc that did `count` things: `skipped` for none. */
const counted = (count: number): ProcOutcome =>
  count === 0 ? PROC_SKIPPED : (COUNTED[count] ?? procOutcome('landed', { amount: count }));

/** A template's id from its name or id. Throws for one the registry does not have. */
const templateOf = <G extends UnitTypes>(engine: UnitEngine<G>, unit: G['unitName'] | UnitId): UnitId => {
  const ids: Readonly<Record<string, UnitId | undefined>> = engine.registry.id;
  const id = typeof unit === 'string' ? ids[unit] : unit;

  if (id === undefined) {
    throw new RangeError(`unknown unit template ${unit}.`);
  }

  engine.registry.get(id);

  return id;
};

/** The `revive` kind. */
const reviveKind = <G extends UnitTypes>(parts: UnitKindParts<G>): ProcKindDef<ReviveProc<G>, G> => ({
  targetOf: (proc) => proc.to,

  apply: (proc, _ctx, unit) => (unit !== undefined && parts.revive(unit, proc.health) ? PROC_LANDED : PROC_SKIPPED),

  prepare: (proc) => {
    if (proc.health !== undefined && !(proc.health > 0 && Number.isFinite(proc.health))) {
      throw new RangeError(`a revive proc's health is a finite number above 0; got ${proc.health}.`);
    }

    return proc;
  },
});

/** A summon's base stats: its own, then each inherited share of its owner's totals. */
const summonStats = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  [proc, owner]: readonly [SummonProc<G>, G['bearer']],
): Readonly<Partial<Record<G['stat'], number>>> | undefined => {
  if (proc.inherit === undefined) {
    return proc.stats;
  }

  const { inherit } = proc;
  const view = engine.statsOf(owner);
  const stats: Partial<Record<G['stat'], number>> = { ...proc.stats };
  const names = Object.keys(inherit).filter((key): key is G['stat'] => Object.hasOwn(inherit, key));

  for (const stat of names) {
    const id = engine.registry.stats.index.idOf(stat);

    if (id === undefined) {
      throw new RangeError(`a summon inherits no stat named ${stat}.`);
    }

    stats[stat] = view.total(id) * (inherit[stat] ?? 0);
  }

  return stats;
};

/** Spawns one summon of a summon proc: at its point, on its side, owned by `owner`, held by the running cast. */
const spawnSummon = <G extends UnitTypes>(
  parts: UnitKindParts<G>,
  [proc, ctx, owner]: readonly [SummonProc<G>, ProcContext<G>, G['bearer']],
  [template, stats]: readonly [UnitId, Readonly<Partial<Record<G['stat'], number>>> | undefined],
): void => {
  const at = proc.atOf?.(ctx) ?? proc.at;
  const spec: SpawnUnit<G> = { side: proc.side ?? unitOf<G>(owner).side, owner, isBound: proc.isBound !== false };

  const unit = parts.spawn(template, {
    ...spec,
    ...(stats === undefined ? {} : { stats }),
    ...(at === undefined ? {} : { at }),
  });

  const { spells } = parts.engine.options;
  const cast = spells.current;

  if (cast !== NO_CAST && spells.retain(cast)) {
    unitOf<G>(unit).cast = cast;
  }
};

/**
 * Whether one more summon of a template fits its owner's limit: under it, yes; at it, the owner's oldest of the template
 * despawns as `replaced` (`oldest`), or the summon is refused (`refuse`).
 */
const admitSummon = <G extends UnitTypes>(
  parts: UnitKindParts<G>,
  [proc, owner]: readonly [SummonProc<G>, G['bearer']],
  template: UnitId,
): boolean => {
  const { limit } = proc;

  if (limit === undefined) {
    return true;
  }

  const { summons } = unitOf<G>(owner);
  let count = 0;
  let oldest: G['bearer'] | undefined = undefined;

  for (const summon of summons) {
    if (unitOf<G>(summon).template === template) {
      oldest ??= summon;
      count += 1;
    }
  }

  if (count < limit.perOwner) {
    return true;
  }

  if (limit.replace === 'refuse' || oldest === undefined) {
    return false;
  }

  return parts.despawn(oldest, 'replaced');
};

/** The `summon` kind. */
const summonKind = <G extends UnitTypes>(parts: UnitKindParts<G>): ProcKindDef<SummonProc<G>, G> => ({
  targetOf: (proc) => proc.to ?? 'self',

  apply: (proc, ctx, owner) => {
    if (owner === undefined) {
      return PROC_SKIPPED;
    }

    const { engine } = parts;
    const template = templateOf(engine, proc.unit);
    const count = Math.max(0, Math.floor(proc.countOf?.(ctx) ?? proc.count ?? 1));
    const stats = summonStats(engine, [proc, owner]);

    let summoned = 0;

    for (let i = 0; i < count && admitSummon(parts, [proc, owner], template); i++) {
      spawnSummon(parts, [proc, ctx, owner], [template, stats]);
      summoned += 1;
    }

    return counted(summoned);
  },

  prepare: (proc) => {
    if (proc.count !== undefined && !(Number.isInteger(proc.count) && proc.count >= 0)) {
      throw new RangeError(`a summon proc's count is a whole number from 0; got ${proc.count}.`);
    }

    const limit = proc.limit?.perOwner;

    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1)) {
      throw new RangeError(`a summon proc's limit is a whole number from 1; got ${limit}.`);
    }

    return { ...proc, unit: templateOf(parts.engine, proc.unit) };
  },
});

/** The `despawn` kind. */
const despawnKind = <G extends UnitTypes>(parts: UnitKindParts<G>): ProcKindDef<DespawnProc<G>, G> => ({
  targetOf: (proc) => proc.to,

  apply: (proc, _ctx, unit) =>
    unit !== undefined && parts.despawn(unit, proc.reason ?? 'despawn') ? PROC_LANDED : PROC_SKIPPED,
});

/** The `despawnSummons` kind. */
const despawnSummonsKind = <G extends UnitTypes>(parts: UnitKindParts<G>): ProcKindDef<DespawnSummonsProc<G>, G> => ({
  targetOf: (proc) => proc.to ?? 'self',

  apply: (proc, _ctx, owner) => {
    if (owner === undefined) {
      return PROC_SKIPPED;
    }

    const template = proc.unit === undefined ? undefined : templateOf(parts.engine, proc.unit);
    let count = 0;

    for (const summon of unitOf<G>(owner).summons.slice()) {
      if (
        (template === undefined || unitOf<G>(summon).template === template) &&
        parts.despawn(summon, proc.reason ?? 'owner')
      ) {
        count += 1;
      }
    }

    return counted(count);
  },

  prepare: (proc) => (proc.unit === undefined ? proc : { ...proc, unit: templateOf(parts.engine, proc.unit) }),
});

/** Builds the unit system's proc kinds. */
export const createUnitProcKinds = <G extends UnitTypes>(parts: UnitKindParts<G>): UnitProcKinds<G> =>
  Object.freeze({
    revive: reviveKind(parts),
    summon: summonKind(parts),
    despawn: despawnKind(parts),
    despawnSummons: despawnSummonsKind(parts),
  });
