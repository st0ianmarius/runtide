import type { Vec2 } from '../math/index.ts';
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

/** Where one summon stands: the proc's point, its read point, or one picked around the owner. */
const summonPoint = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  [proc, ctx, owner]: readonly [SummonProc<G>, ProcContext<G>, G['bearer']],
): Vec2 | undefined => {
  const at = proc.atOf?.(ctx) ?? proc.at;
  const { around } = proc;

  if (at !== undefined || around === undefined) {
    return at;
  }

  const world = engine.options.world ?? noWorld();

  return world.pickPoint({
    centre: world.positionOf(owner),
    min: around.min ?? 0,
    max: around.max,
    clearance: around.clearance ?? 0,
    attempts: around.attempts ?? 8,
    random: ctx.random(),
  });
};

/** The unit system has no world to pick a summon's point in. */
const noWorld = (): never => {
  throw new TypeError('A summon placed around its owner needs the unit system’s world.');
};

/** The `summon` kind. */
const summonKind = <G extends UnitTypes>(parts: UnitKindParts<G>): ProcKindDef<SummonProc<G>, G> => ({
  targetOf: (proc) => proc.by ?? 'self',

  apply: (proc, ctx, owner) => {
    if (owner === undefined) {
      return PROC_SKIPPED;
    }

    const { engine } = parts;
    const template = templateOf(engine, proc.unit);
    const count = Math.max(0, Math.floor(proc.countOf?.(ctx) ?? proc.count ?? 1));
    const stats = summonStats(engine, [proc, owner]);
    const { spells } = engine.options;

    for (let i = 0; i < count; i++) {
      const at = summonPoint(engine, [proc, ctx, owner]);
      const spec: SpawnUnit<G> = { side: unitOf<G>(owner).side, owner, isBound: proc.isBound !== false };

      const unit = parts.spawn(template, {
        ...spec,
        ...(stats === undefined ? {} : { stats }),
        ...(at === undefined ? {} : { at }),
      });

      const cast = spells.current;

      if (cast !== NO_CAST && spells.hold(cast)) {
        unitOf<G>(unit).cast = cast;
      }
    }

    return counted(count);
  },

  prepare: (proc) => {
    if (proc.count !== undefined && !(Number.isInteger(proc.count) && proc.count >= 0)) {
      throw new RangeError(`a summon proc's count is a whole number from 0; got ${proc.count}.`);
    }

    if (proc.around !== undefined && parts.engine.options.world === undefined) {
      noWorld();
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
  targetOf: (proc) => proc.of ?? 'self',

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
