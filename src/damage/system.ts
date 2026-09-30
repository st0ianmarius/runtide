import type { AuraSystem } from '../auras/index.ts';
import { PROC_LANDED, PROC_SKIPPED, type ProcOutcome } from '../procs/index.ts';
import type { Blow, BlowSpec } from './blow.ts';
import { createDamagePipeline } from './damage-pipeline.ts';
import type { DamageKindId, DamageTypes } from './damage-types.ts';
import { runDeath } from './death-pipeline.ts';
import { DamageEngine } from './engine.ts';
import { explainRolls, explainRows, type MitigationExplanation } from './explain.ts';
import { createForcePipeline } from './force-pipeline.ts';
import type { Force, ForceSpec } from './force.ts';
import { createHealPipeline } from './heal-pipeline.ts';
import type { Heal, HealSpec } from './heal.ts';
import type { DamageKindTable } from './kinds.ts';
import type { DamageHost, DamageSystemOptions } from './options.ts';
import { createDamageProcKinds, SET_KILLED } from './proc-kinds.ts';
import type { DamageProcKinds } from './procs.ts';
import type { RecordsCheck } from './records-check.ts';
import type { RollEffect } from './rolls.ts';

/** Who a `setHealth` is credited to, for a death it causes. */
export interface HealthCredit<G extends DamageTypes> {
  /** The killer, if any. */
  readonly attacker?: G['bearer'] | undefined;

  /** The credited entity id; the host's id of the attacker, else `NO_SOURCE`, when absent. */
  readonly source?: number | undefined;

  /** The spell, if any. */
  readonly spell?: G['spell'] | undefined;
}

/**
 * A damage system (§I.6, §II.6 D1–D5): one side-agnostic damage pipeline for any unit, a heal pipeline, a force
 * pipeline and the death pipeline, over the game's aura system and host, with the game's own stages at their declared
 * positions. Every record it returns is reused per nesting level: read it before the next call at that level.
 */
export interface DamageSystem<G extends DamageTypes> {
  /** The aura system whose hooks the pipelines call. */
  readonly auras: AuraSystem<G>;

  /** The game's damage kinds. */
  readonly kinds: DamageKindTable<G['damageKind']>;

  /** The host. */
  readonly host: DamageHost<G>;

  /** The damage pipeline's stage names, in run order, the game's included. */
  readonly stages: readonly string[];

  /** The heal pipeline's stage names, in run order. */
  readonly healStages: readonly string[];

  /** The force pipeline's stage names, in run order. */
  readonly forceStages: readonly string[];

  /** The game's own stages (`damage.name`, `heal.name`, `force.name`), in declaration order, for the escape report. */
  readonly gameStages: readonly string[];

  /** The proc kinds `damage`, `heal` and `setHealth`: `createProcRegistry({ ...CORE_PROCS, ...damage.procKinds })`. */
  readonly procKinds: DamageProcKinds<G>;

  /** How many blows, heals, forces and deaths are running right now: 0 outside any. */
  readonly depth: number;

  /** Deals a blow through the damage pipeline and returns it, done. */
  readonly hit: (spec: BlowSpec<G>) => Blow<G>;

  /** Heals through the heal pipeline and returns the heal, done. */
  readonly heal: (spec: HealSpec<G>) => Heal<G>;

  /** Pushes a force through the force pipeline and returns it, done. */
  readonly force: (spec: ForceSpec<G>) => Force<G>;

  /**
   * Sets a unit's health outright, bypassing the heal stages (§II.6 P3). A unit that was alive and is dead by the
   * system's rule afterwards goes through the death pipeline, credited as given. A dead unit is `skipped`.
   */
  readonly setHealth: (unit: G['bearer'], health: number, credit?: HealthCredit<G>) => ProcOutcome;

  /** Heals a unit by its regeneration stat for `seconds`, through the heal pipeline (§II.6 D3). */
  readonly regenerate: (unit: G['bearer'], seconds: number) => Heal<G>;

  /** Whether a unit is dead by the system's rule. */
  readonly isDead: (unit: G['bearer']) => boolean;

  /**
   * The mitigation rows a blow of one kind would meet on a defender, from an attacker (none for the world's), as data
   * (§II.3.14, §I.5.3): each row's rating before and after penetration and its factor, and the product of them all.
   */
  readonly explainMitigation: (
    defender: G['bearer'],
    options: {
      /** The attacker, if any. */
      readonly attacker?: G['bearer'] | undefined;

      /** The damage kind; the table's first when absent. */
      readonly kind?: DamageKindId | undefined;
    },
  ) => MitigationExplanation;

  /**
   * The outcome rows explained for a pair (§II.3.14, §I.5.3): each row's outcome, effect, chance (clamped to [0, 1])
   * and multiplier, read from the attacker's stats (by a spell's shares when one is given) and the defender's, so
   * the client can print "12% to dodge". In `single` mode each chance is the row's own, before earlier rows push it.
   */
  readonly explainRolls: (defender: G['bearer'], query?: RollQuery<G>) => RollExplanation[];
}

/** Who a roll explanation is for, beyond the defender. */
export interface RollQuery<G extends DamageTypes> {
  /** The attacker, if any. */
  readonly attacker?: G['bearer'] | undefined;

  /** The spell whose shares the attacker's stats are read by. */
  readonly spell?: G['spell'] | undefined;
}

/** One outcome row explained. */
export interface RollExplanation {
  /** Its outcome name. */
  readonly outcome: string;

  /** What it does. */
  readonly effect: RollEffect;

  /** Its chance, clamped to [0, 1]. */
  readonly chance: number;

  /** Its multiplier, for a `scale` row. */
  readonly multiplier: number | undefined;
}

/** Builds `setHealth` over the death pipeline. */
const setHealthWith =
  <G extends DamageTypes>(engine: DamageEngine<G>) =>
  (unit: G['bearer'], health: number, credit: HealthCredit<G> = {}): ProcOutcome => {
    const before = engine.host.health(unit);

    if (engine.isDead(before)) {
      return PROC_SKIPPED;
    }

    engine.host.setHealth(unit, health);

    if (!engine.isDead(health)) {
      return PROC_LANDED;
    }

    runDeath(engine, {
      unit,
      killer: credit.attacker,
      source: engine.sourceOf(credit.source, credit.attacker),
      spell: credit.spell,
      blow: undefined,
    });

    return SET_KILLED;
  };

/** A regeneration heal's spec, reused, since the heal pipeline copies it at once. */
interface RegenSpec<G extends DamageTypes> {
  /** Who regenerates. */
  target: G['bearer'];

  /** How much. */
  amount: number;
}

/** Builds `regenerate` over the heal pipeline, with a reused spec. */
const regenerateWith = <G extends DamageTypes>(engine: DamageEngine<G>, heal: (spec: HealSpec<G>) => Heal<G>) => {
  const stat = engine.stats.regeneration;
  let spec: RegenSpec<G> | undefined;

  return (unit: G['bearer'], seconds: number): Heal<G> => {
    const perSecond = stat === undefined ? 0 : engine.viewOf(unit, undefined).total(stat);

    spec ??= { target: unit, amount: 0 };
    spec.target = unit;
    spec.amount = perSecond * seconds;

    return heal(spec);
  };
};

/** The names of the game's own stages, by pipeline. */
const gameStagesOf = <G extends DamageTypes>(engine: DamageEngine<G>): readonly string[] =>
  Object.freeze([
    ...engine.order.game.map((name) => `damage.${name}`),
    ...engine.healOrder.game.map((name) => `heal.${name}`),
    ...engine.forceOrder.game.map((name) => `force.${name}`),
  ]);

/** A damage system: a class for fast properties, its functions arrow fields so they work detached. */
class Damage<G extends DamageTypes> implements DamageSystem<G> {
  readonly auras: AuraSystem<G>;
  readonly kinds: DamageKindTable<G['damageKind']>;
  readonly host: DamageHost<G>;
  readonly stages: readonly string[];
  readonly healStages: readonly string[];
  readonly forceStages: readonly string[];
  readonly gameStages: readonly string[];
  readonly procKinds: DamageProcKinds<G>;
  readonly hit: (spec: BlowSpec<G>) => Blow<G>;
  readonly heal: (spec: HealSpec<G>) => Heal<G>;
  readonly force: (spec: ForceSpec<G>) => Force<G>;
  readonly setHealth: (unit: G['bearer'], health: number, credit?: HealthCredit<G>) => ProcOutcome;
  readonly regenerate: (unit: G['bearer'], seconds: number) => Heal<G>;
  readonly #engine: DamageEngine<G>;

  constructor(options: DamageSystemOptions<G>, engine: DamageEngine<G>) {
    const force = createForcePipeline(engine);
    const heal = createHealPipeline(engine);
    const setHealth = setHealthWith(engine);

    this.auras = options.auras;
    this.kinds = options.kinds;
    this.host = options.host;
    this.stages = engine.order.names;
    this.healStages = engine.healOrder.names;
    this.forceStages = engine.forceOrder.names;
    this.gameStages = gameStagesOf(engine);
    this.hit = createDamagePipeline(engine, {
      force,

      death: (spec) => {
        runDeath(engine, spec);
      },
    });
    this.heal = heal;
    this.force = force;
    this.setHealth = setHealth;
    this.regenerate = regenerateWith(engine, heal);
    this.#engine = engine;

    this.procKinds = createDamageProcKinds(engine, {
      hit: this.hit,
      heal,
      setHealth: (unit, health, source) => setHealth(unit, health, { source }),
      force,
    });
  }

  get depth(): number {
    return this.#engine.depth;
  }

  readonly isDead = (unit: G['bearer']): boolean => this.#engine.isDeadNow(unit);

  readonly explainMitigation = (
    defender: G['bearer'],
    query: { readonly attacker?: G['bearer'] | undefined; readonly kind?: DamageKindId | undefined },
  ): MitigationExplanation =>
    explainRows(this.#engine.rows, {
      kind: query.kind ?? this.#engine.defaultKind,
      caster: this.#engine.viewOf(query.attacker, undefined),
      target: this.#engine.viewOf(defender, undefined),
    });

  readonly explainRolls = (defender: G['bearer'], query: RollQuery<G> = {}): RollExplanation[] =>
    explainRolls(this.#engine, defender, query);
}

/**
 * Creates the damage system (§I.5): `createDamageSystem({ auras, kinds: DAMAGE_KINDS, host, stats, outgoing: ['damage'],
 * crit: { chance: 'critChance', damage: 'critDamage' }, mitigation: MITIGATION, stages: { … } })`. Every stage order,
 * kind bypass, stat, tag and mitigation row is checked here, so a mistake fails at load. The game's aura types must
 * point `blow` at `Blow<Game>` and `force` at `Force<Game>`.
 */
export const createDamageSystem = <G extends DamageTypes>(
  options: DamageSystemOptions<G> & RecordsCheck<G>,
): DamageSystem<G> => {
  const engine = new DamageEngine<G>(options);
  const system: DamageSystem<G> = Object.freeze(new Damage(options, engine));

  engine.system = system;

  return system;
};
