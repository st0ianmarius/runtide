import { ownValue } from '../core/records.ts';
import type { Vec2 } from '../math/index.ts';
import {
  PROC_LANDED,
  PROC_SKIPPED,
  type ProcContext,
  type ProcKindDef,
  type ProcOutcome,
  procOutcome
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
  procOutcome('landed', { amount })
);

/** The outcome of a proc that did `count` things: `skipped` for none. */
const counted = (count: number): ProcOutcome =>
  count === 0 ? PROC_SKIPPED : (COUNTED[count] ?? procOutcome('landed', { amount: count }));

/** Whether a unit is in play: summoning stops the moment a callback takes its owner out. */
const isAlive = (unit: UnitTypes['bearer']): boolean => unitOf(unit).lifecycle === 'alive';

/** A template's id from its name or id. Throws for one the registry does not have. */
const templateOf = <G extends UnitTypes>(engine: UnitEngine<G>, unit: G['unitName'] | UnitId): UnitId => {
  const ids: Readonly<Record<string, UnitId | undefined>> = engine.registry.id;
  const id = typeof unit === 'string' ? ownValue(ids, unit) : unit;

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
  }
});

/** A summon's base stats: its own, then each inherited share of its owner's totals. */
const summonStats = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  [proc, owner]: readonly [SummonProc<G>, G['bearer']]
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

/** One summon's spawn: on its side, owned by `owner`, with its stats, point and the game's data. */
const summonSpec = <G extends UnitTypes>(
  [proc, ctx, owner]: readonly [SummonProc<G>, ProcContext<G>, G['bearer']],
  stats: Readonly<Partial<Record<G['stat'], number>>> | undefined,
  at: Vec2 | undefined
): SpawnUnit<G> => {
  const data = proc.dataOf === undefined ? proc.data : proc.dataOf(ctx);

  return {
    side: proc.side ?? unitOf<G>(owner).side,
    owner,
    isBound: proc.isBound !== false,
    ...(stats === undefined ? {} : { stats }),
    ...(at === undefined ? {} : { at }),
    ...(data === undefined ? {} : { data })
  };
};

/** Spawns one summon of a summon proc as its spec says, held by the running cast. */
const spawnSummon = <G extends UnitTypes>(
  parts: UnitKindParts<G>,
  ctx: ProcContext<G>,
  [template, spec]: readonly [UnitId, SpawnUnit<G>]
): void => {
  const unit = parts.spawn(template, spec);

  const { spells } = parts.engine.options;
  const cast = spells.castFor(ctx);

  // A summon its own `spawned` listeners despawned holds nothing.
  if (cast !== NO_CAST && isAlive(unit) && spells.retain(cast)) {
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
  template: UnitId
): boolean => {
  const { limit } = proc;

  if (limit === undefined) {
    return true;
  }

  if (occupied(parts.engine, owner, template) < limit.perOwner) {
    return true;
  }

  const oldest = oldestOf<G>(owner, template);

  if (limit.replace === 'refuse' || oldest === undefined) {
    return false;
  }

  return replaceSummon(parts, owner, oldest, template, limit.perOwner);
};

/**
 * The slots of a template an owner fills: its summons of it, and the replacements reserved for it while their
 * callbacks run, so a nested summon cannot take a slot an outer one is freeing.
 */
const occupied = <G extends UnitTypes>(engine: UnitEngine<G>, owner: G['bearer'], template: UnitId): number => {
  const { admittingOwners, admittingTemplates } = engine;
  let count = 0;

  for (let i = 0; i < admittingOwners.length; i++) {
    if (admittingOwners[i] === owner && admittingTemplates[i] === template) {
      count += 1;
    }
  }

  for (const summon of unitOf<G>(owner).summons) {
    if (unitOf<G>(summon).template === template) {
      count += 1;
    }
  }

  return count;
};

/** An owner's oldest summon of a template, if it has one. */
const oldestOf = <G extends UnitTypes>(owner: G['bearer'], template: UnitId): G['bearer'] | undefined => {
  for (const summon of unitOf<G>(owner).summons) {
    if (unitOf<G>(summon).template === template) {
      return summon;
    }
  }

  return undefined;
};

/** Reserves the replacement slot across callbacks, then checks nothing else filled it. */
const replaceSummon = <G extends UnitTypes>(
  parts: UnitKindParts<G>,
  owner: G['bearer'],
  oldest: G['bearer'],
  template: UnitId,
  limit: number
): boolean => {
  const { admittingOwners, admittingTemplates } = parts.engine;
  admittingOwners.push(owner);
  admittingTemplates.push(template);

  try {
    if (!parts.despawn(oldest, 'replaced')) {
      return false;
    }

    // A callback may spawn directly, bypassing this proc: recount, every reservation but this one included.
    return occupied(parts.engine, owner, template) - 1 < limit;
  } finally {
    admittingOwners.pop();
    admittingTemplates.pop();
  }
};

/** The number this invocation requests, evaluated once before spawning. */
const summonCount = <G extends UnitTypes>(proc: SummonProc<G>, ctx: ProcContext<G>): number =>
  Math.max(0, Math.floor(proc.countOf?.(ctx) ?? proc.count ?? 1));

/**
 * Makes one summon of a summon proc: `made`; `skipped` when `atOf` finds no point and the proc skips; `stop` when it
 * stops there, the game does not admit it (a crowd cap, asked before the owner's limit so a refusal ends no older
 * summon), the limit refuses it, or a callback took the owner out.
 */
const summonOne = <G extends UnitTypes>(
  parts: UnitKindParts<G>,
  [proc, ctx, owner]: readonly [SummonProc<G>, ProcContext<G>, G['bearer']],
  [template, stats]: readonly [UnitId, Readonly<Partial<Record<G['stat'], number>>> | undefined]
): 'made' | 'skipped' | 'stop' => {
  const at = proc.atOf === undefined ? proc.at : proc.atOf(ctx);

  if (proc.atOf !== undefined && at === undefined) {
    return proc.onNoPoint === 'stop' ? 'stop' : 'skipped';
  }

  const spec = summonSpec([proc, ctx, owner], stats, at);

  if (
    !isAlive(owner) ||
    parts.engine.options.admit?.(template, spec) === false ||
    !admitSummon(parts, [proc, owner], template) ||
    !isAlive(owner)
  ) {
    return 'stop';
  }

  spawnSummon(parts, ctx, [template, spec]);

  return 'made';
};

/** The `summon` kind. */
const summonKind = <G extends UnitTypes>(parts: UnitKindParts<G>): ProcKindDef<SummonProc<G>, G> => ({
  targetOf: (proc) => proc.to ?? 'self',

  apply: (proc, ctx, owner) => {
    // A late list (an `after` from a caster gone since) summons nothing for an owner out of play.
    if (owner === undefined || !isAlive(owner)) {
      return PROC_SKIPPED;
    }

    const { engine } = parts;
    const template = templateOf(engine, proc.unit);
    const count = summonCount(proc, ctx);
    const stats = summonStats(engine, [proc, owner]);

    let summoned = 0;

    // `atOf`, `admit`, a replaced summon's despawn and the spawn's listeners are callbacks: each may take the owner out.
    for (let i = 0; i < count && isAlive(owner); i++) {
      const made = summonOne(parts, [proc, ctx, owner], [template, stats]);

      if (made === 'stop') {
        break;
      }

      summoned += made === 'made' ? 1 : 0;
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
  }
});

/** The `despawn` kind. */
const despawnKind = <G extends UnitTypes>(parts: UnitKindParts<G>): ProcKindDef<DespawnProc<G>, G> => ({
  targetOf: (proc) => proc.to,

  apply: (proc, _ctx, unit) =>
    unit !== undefined && parts.despawn(unit, proc.reason ?? 'despawn') ? PROC_LANDED : PROC_SKIPPED
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

  prepare: (proc) => (proc.unit === undefined ? proc : { ...proc, unit: templateOf(parts.engine, proc.unit) })
});

/** Builds the unit system's proc kinds. */
export const createUnitProcKinds = <G extends UnitTypes>(parts: UnitKindParts<G>): UnitProcKinds<G> =>
  Object.freeze({
    revive: reviveKind(parts),
    summon: summonKind(parts),
    despawn: despawnKind(parts),
    despawnSummons: despawnSummonsKind(parts)
  });
