import type { AuraId } from '../auras/index.ts';
import type { Vec2 } from '../math/index.ts';
import { finishScaled, type StatId } from '../modifiers/index.ts';
import { PROC_SKIPPED, type ProcContext, procOutcome, type ProcOutcome, type ProcResolver } from '../procs/index.ts';
import type { Blow, BlowSpec } from './blow.ts';
import type { BlowStatus, DamageKindId, DamageTypes } from './damage-types.ts';
import type { DamageEngine } from './engine.ts';
import { forceKind } from './force-kind.ts';
import type { Force, ForceSpec } from './force.ts';
import type { Heal, HealSpec } from './heal.ts';
import type { DamageProc, DamageProcKinds, HealProc, ProcAmount, SetHealthProc } from './procs.ts';

/** What the proc kinds reach: the pipelines. */
export interface ProcPipelines<G extends DamageTypes> {
  /** The damage pipeline. */
  readonly hit: (spec: BlowSpec<G>) => Blow<G>;

  /** The heal pipeline. */
  readonly heal: (spec: HealSpec<G>) => Heal<G>;

  /** Sets health, crediting a kill to `source`. */
  readonly setHealth: (unit: G['bearer'], health: number, source: number) => ProcOutcome;

  /** The force pipeline. */
  readonly force: (spec: ForceSpec<G>) => Force<G>;
}

/** The outcome of a `setHealth` that killed. */
export const SET_KILLED: ProcOutcome = procOutcome('landed', { hasKilled: true });

/** Whether a status is one a follow-up list waits for (`landed` when the proc names none). */
const isAwaited = (status: string, on: BlowStatus | readonly BlowStatus[] | undefined): boolean => {
  if (on === undefined) {
    return status === 'landed';
  }

  return typeof on === 'string' ? status === on : on.some((each) => each === status);
};

/** A proc amount at one target: a number as is, a snapshot finished against the target's stats. */
const amountAt = <G extends DamageTypes>(engine: DamageEngine<G>, amount: ProcAmount, target: G['bearer']): number =>
  typeof amount === 'number' ? amount : finishScaled(amount, engine.host.statsOf?.(target, undefined));

/**
 * The unit a list is credited to: `self` when the list's source is `self`'s own id (a trigger, a spell), else the host's
 * `unitOf` the source (a periodic beat on its victim, credited to its caster).
 */
const creditedUnit = <G extends DamageTypes>(engine: DamageEngine<G>, ctx: ProcContext<G>): G['bearer'] | undefined => {
  const own = engine.host.idOf?.(ctx.self);

  return own === undefined || own === ctx.source ? ctx.self : engine.host.unitOf?.(ctx.source);
};

/** The numbers of a record that are present, for an explanation. */
const numbersOf = (values: Readonly<Record<string, number | undefined>>): Readonly<Record<string, number>> =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined));

/** The spec a damage proc fills, reused for every one, since the pipeline copies it at once. */
class ProcBlowSpec<G extends DamageTypes> implements BlowSpec<G> {
  target: G['bearer'];
  amount = 0;
  attacker: G['bearer'] | undefined = undefined;
  source: number | undefined = undefined;
  spell: G['spell'] | undefined = undefined;
  aura: AuraId | undefined = undefined;
  kind: DamageKindId | undefined = undefined;
  from: Vec2 | undefined = undefined;
  direction: Vec2 | undefined = undefined;
  ext: G['blowExt'] | undefined = undefined;
  skips: readonly string[] | undefined = undefined;
  bypass: readonly string[] | undefined = undefined;

  constructor(target: G['bearer']) {
    this.target = target;
  }
}

/** The spec a heal proc fills, reused like a damage proc's. */
class ProcHealSpec<G extends DamageTypes> implements HealSpec<G> {
  target: G['bearer'];
  amount = 0;
  healer: G['bearer'] | undefined = undefined;
  source: number | undefined = undefined;
  spell: G['spell'] | undefined = undefined;
  aura: AuraId | undefined = undefined;

  constructor(target: G['bearer']) {
    this.target = target;
  }
}

/** The name resolvers the kinds use, over the system's tables. */
const resolversOf = <G extends DamageTypes>(engine: DamageEngine<G>) => {
  const kindIds: Readonly<Record<string, DamageKindId | undefined>> = engine.kinds.id;

  return {
    kind: (kind: G['damageKind'] | DamageKindId | undefined): DamageKindId | undefined => {
      if (typeof kind !== 'string') {
        return kind;
      }

      return (
        kindIds[kind] ??
        ((): never => {
          throw new RangeError(`Unknown damage kind ${kind}.`);
        })()
      );
    },

    stat: (stat: G['stat'] | StatId): StatId => {
      if (typeof stat !== 'string') {
        return stat;
      }

      return (
        engine.options.stats?.index.idOf(stat) ??
        ((): never => {
          throw new RangeError(`Unknown stat ${stat}.`);
        })()
      );
    },
  };
};

/** The `damage` kind. */
const damageKind = <G extends DamageTypes>(engine: DamageEngine<G>, pipelines: ProcPipelines<G>) => {
  const names = resolversOf(engine);
  let spec: ProcBlowSpec<G> | undefined;

  return {
    targetOf: (proc: DamageProc<G>) => proc.to,

    apply: (proc: DamageProc<G>, ctx: ProcContext<G>, target: G['bearer'] | undefined): ProcOutcome => {
      if (target === undefined) {
        return PROC_SKIPPED;
      }

      spec ??= new ProcBlowSpec<G>(target);
      spec.target = target;
      spec.amount = amountAt(engine, proc.amount, target);
      spec.attacker = proc.attacker === 'none' ? undefined : creditedUnit(engine, ctx);
      spec.source = ctx.source;
      spec.spell = proc.spell;
      spec.aura = ctx.aura?.id;
      spec.kind = names.kind(proc.damageKind);
      spec.from = proc.from;
      spec.direction = proc.direction;
      spec.ext = proc.ext;
      spec.skips = proc.skips;
      spec.bypass = proc.bypass;

      return pipelines.hit(spec);
    },

    follow: (proc: DamageProc<G>, outcome: ProcOutcome) =>
      proc.andThen !== undefined && isAwaited(outcome.status, proc.on) ? proc.andThen : undefined,

    prepare: (proc: DamageProc<G>, resolve: ProcResolver<G>): DamageProc<G> => ({
      ...proc,
      ...(proc.damageKind === undefined ? {} : { damageKind: names.kind(proc.damageKind) ?? proc.damageKind }),
      ...(proc.andThen === undefined ? {} : { andThen: resolve.procs(proc.andThen) }),
    }),

    explain: (proc: DamageProc<G>) => ({
      values: numbersOf({
        amount: typeof proc.amount === 'number' ? proc.amount : undefined,
        damageKind: names.kind(proc.damageKind),
      }),

      ...(proc.andThen === undefined ? {} : { procs: proc.andThen }),
    }),
  };
};

/** The `heal` kind. */
const healKind = <G extends DamageTypes>(engine: DamageEngine<G>, pipelines: ProcPipelines<G>) => {
  const names = resolversOf(engine);
  let spec: ProcHealSpec<G> | undefined;

  return {
    targetOf: (proc: HealProc<G>) => proc.to,

    apply: (proc: HealProc<G>, ctx: ProcContext<G>, target: G['bearer'] | undefined): ProcOutcome => {
      if (target === undefined) {
        return PROC_SKIPPED;
      }

      const amount = amountAt(engine, proc.amount, target);

      spec ??= new ProcHealSpec<G>(target);
      spec.target = target;
      spec.amount =
        proc.of === undefined ? amount : amount * engine.viewOf(target, undefined).total(names.stat(proc.of));
      spec.healer = creditedUnit(engine, ctx);
      spec.source = ctx.source;
      spec.spell = proc.spell;
      spec.aura = ctx.aura?.id;

      return pipelines.heal(spec);
    },

    prepare: (proc: HealProc<G>): HealProc<G> => (proc.of === undefined ? proc : { ...proc, of: names.stat(proc.of) }),

    explain: (proc: HealProc<G>) => ({
      values: numbersOf({
        amount: typeof proc.amount === 'number' ? proc.amount : undefined,
        of: proc.of === undefined ? undefined : names.stat(proc.of),
      }),
    }),
  };
};

/** The `setHealth` kind. */
const setHealthKind = <G extends DamageTypes>(engine: DamageEngine<G>, pipelines: ProcPipelines<G>) => ({
  targetOf: (proc: SetHealthProc<G>) => proc.to,

  apply: (proc: SetHealthProc<G>, ctx: ProcContext<G>, target: G['bearer'] | undefined): ProcOutcome => {
    if (target === undefined) {
      return PROC_SKIPPED;
    }

    const health = typeof proc.health === 'number' ? proc.health : proc.health.share * engine.maxHealthOf(target);

    return pipelines.setHealth(target, health, ctx.source);
  },

  explain: (proc: SetHealthProc<G>) => ({
    values: typeof proc.health === 'number' ? { health: proc.health } : { share: proc.health.share },
  }),
});

/** The damage system's proc kinds over its pipelines. */
export const createDamageProcKinds = <G extends DamageTypes>(
  engine: DamageEngine<G>,
  pipelines: ProcPipelines<G>,
): DamageProcKinds<G> =>
  Object.freeze({
    damage: damageKind(engine, pipelines),
    heal: healKind(engine, pipelines),
    setHealth: setHealthKind(engine, pipelines),
    force: forceKind(pipelines.force),
  });
