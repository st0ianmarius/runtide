import {
  type ActiveAura,
  type AuraContext,
  type AuraPipelineHook,
  type AuraSystem,
  NO_SOURCE,
} from '../auras/index.ts';
import { createScratch, type Scratch } from '../core/index.ts';
import { shareOf, type StatId, type StatView } from '../modifiers/index.ts';
import { type Blow, BlowRecord } from './blow.ts';
import {
  checkHost,
  compileBypass,
  compileStats,
  DAMAGE_STAGES,
  FORCE_STAGES,
  HEAL_STAGES,
  orderOf,
  rowsOf,
  type StageStats,
} from './compile.ts';
import type { BlowStop, DamageKindId, DamageTypes, RollSlot } from './damage-types.ts';
import { DeathRecord } from './death.ts';
import { ForceRecord } from './force.ts';
import { HealRecord } from './heal.ts';
import type { DamageKindTable } from './kinds.ts';
import { type CompiledRow, NO_STATS, RowContext } from './mitigation.ts';
import type {
  DamageHost,
  DamageStage,
  DamageSystemOptions,
  ForceStage,
  ForceState,
  HealStage,
  HealState,
} from './options.ts';
import { ROLL_EFFECTS, type RollTable } from './rolls.ts';
import type { StageOrder } from './stage-order.ts';
import type { DamageSystem } from './system.ts';

/** The default death rule: at or below 0 health. */
const isAtOrBelowZero = (health: number): boolean => health <= 0;

/** Throws: something a stage needs is missing from the host. */
export const missing = (what: string): never => {
  throw new TypeError(`The damage system needs ${what}, which its host does not have.`);
};

/** A stat view of an attacker read by a blow's spell's shares, as outgoing multipliers are. Reused. */
class SharedView<G extends DamageTypes> implements StatView {
  view: StatView = NO_STATS;
  spell: G['spell'] | undefined = undefined;
  readonly #engine: DamageEngine<G>;

  constructor(engine: DamageEngine<G>) {
    this.#engine = engine;
  }

  total(stat: StatId): number {
    return this.#engine.sharedBy(this.view, stat, this.spell);
  }

  base(stat: StatId): number {
    return this.view.base(stat);
  }
}

/** The views an outcome row's values read: the attacker's (by shares) as the caster, the defender's as the target. */
class RollViews<G extends DamageTypes> {
  readonly shared: SharedView<G>;
  readonly caster: StatView;
  target: StatView | undefined = undefined;

  constructor(engine: DamageEngine<G>) {
    this.shared = new SharedView<G>(engine);
    this.caster = this.shared;
  }
}

/**
 * The machinery behind one damage system: its compiled tables, its records pooled per nesting level, and the helpers
 * the built-in stages share. The public system object wraps it.
 */
export class DamageEngine<G extends DamageTypes> {
  readonly options: DamageSystemOptions<G>;
  readonly auras: AuraSystem<G>;
  readonly host: DamageHost<G>;
  readonly kinds: DamageKindTable<G['damageKind']>;
  readonly stats: StageStats;
  readonly order: StageOrder<DamageStage<G>>;
  readonly healOrder: StageOrder<HealStage<G>>;
  readonly forceOrder: StageOrder<ForceStage<G>>;
  readonly bypass: Uint8Array;
  readonly rows: readonly CompiledRow[];
  readonly rowContext = new RowContext();

  /** The outcome rows the roll stage rolls, or `undefined` for none. */
  readonly rolls: RollTable | undefined;

  /** Each kind's unrolled effects, as bits over `ROLL_EFFECTS`. */
  readonly unrolled: Uint8Array;

  /** The reused views a roll reads: the attacker's by the blow's spell's shares, and the defender's. */
  readonly rollViews = new RollViews<G>(this);
  readonly isDead: (health: number) => boolean;
  readonly maxDepth: number;
  readonly lists: Scratch<ActiveAura<G>> = createScratch<ActiveAura<G>>();
  readonly blows: BlowRecord<G>[] = [];
  readonly heals: HealRecord<G>[] = [];
  readonly forces: ForceRecord<G>[] = [];
  readonly deaths: DeathRecord<G>[] = [];
  depth = 0;
  #system: DamageSystem<G> | undefined = undefined;

  constructor(options: DamageSystemOptions<G>) {
    this.options = options;
    this.auras = options.auras;
    this.host = options.host;
    this.kinds = options.kinds;
    this.stats = compileStats(options);
    checkHost(options, this.stats);
    this.order = orderOf('Damage', { builtIn: DAMAGE_STAGES, boundary: 'health' }, options.stages);
    this.healOrder = orderOf('Heal', { builtIn: HEAL_STAGES, boundary: 'health' }, options.healStages);
    this.forceOrder = orderOf('Force', { builtIn: FORCE_STAGES, boundary: 'apply' }, options.forceStages);
    this.bypass = compileBypass(options.kinds, this.order);
    this.rows = rowsOf(options, { bypass: this.bypass, order: this.order });
    this.rolls = options.rolls;
    this.unrolled = Uint8Array.from(options.kinds.ids, (kind) =>
      (options.kinds.get(kind).unrolled ?? []).reduce((bits, effect) => bits | (1 << ROLL_EFFECTS.indexOf(effect)), 0),
    );
    this.isDead = options.isDead ?? isAtOrBelowZero;
    this.maxDepth = options.maxDepth ?? 8;

    if (!Number.isInteger(this.maxDepth) || this.maxDepth < 1) {
      throw new RangeError(`Damage system: maxDepth must be a whole number from 1; got ${this.maxDepth}.`);
    }
  }

  /** The public system, which game stages receive. */
  get system(): DamageSystem<G> {
    return this.#system ?? missing('its system object');
  }

  set system(system: DamageSystem<G>) {
    this.#system = system;
  }

  /** The first damage kind: a blow's default. */
  get defaultKind(): DamageKindId {
    return this.kinds.ids[0] ?? missing('a damage kind');
  }

  /** The source a spec credits: its own, else the host's id of `unit`, else none. */
  sourceOf(source: number | undefined, unit: G['bearer'] | undefined): number {
    return source ?? (unit === undefined ? undefined : this.host.idOf?.(unit)) ?? NO_SOURCE;
  }

  /** Whether a unit is dead now, by the system's rule. */
  isDeadNow(unit: G['bearer']): boolean {
    return this.isDead(this.host.health(unit));
  }

  /** A unit's stats for a blow (the attacker's, folded for the blow's spell by the host), or none for no unit. */
  viewOf(unit: G['bearer'] | undefined, blow: Blow<G> | undefined): StatView {
    return unit === undefined ? NO_STATS : (this.host.statsOf ?? missing('statsOf'))(unit, blow);
  }

  /** A unit's maximum health. */
  maxHealthOf(unit: G['bearer']): number {
    return (this.host.maxHealth ?? missing('maxHealth'))(unit);
  }

  /**
   * An attacker's stat for a blow at its spell's share: a multiplier stat by the share-of-1 rule, a flat
   * one times the share; a share of exactly 1 reads the stat unchanged.
   */
  shared(view: StatView, stat: StatId, blow: Blow<G>): number {
    return this.sharedBy(view, stat, blow.spell);
  }

  /** A stat of a view by a spell's share of it (the whole stat for no spell or no share). */
  sharedBy(view: StatView, stat: StatId, spell: G['spell'] | undefined): number {
    const value = view.total(stat);
    const share = spell === undefined ? undefined : this.host.shareOf?.(spell, stat);

    if (share === undefined || share === 1) {
      return value;
    }

    const index = this.options.stats?.index;

    return index?.isMultiplier(stat) === true ? shareOf(value, share, index.neutralOf(stat)) : share * value;
  }

  /** Whether a roll slot hits at a chance: the game's rule, or no draw outside (0, 1) and one draw inside. */
  hits(chance: number, slot: RollSlot, blow: Blow<G>): boolean {
    const rule = this.options.rollChance;

    if (rule !== undefined) {
      return rule(chance, slot, blow);
    }

    if (!(chance > 0)) {
      return false;
    }

    return chance >= 1 || (this.host.roll ?? missing('roll'))(slot, blow) < chance;
  }

  /**
   * Walks the auras of a subject's unit that have one pipeline hook, in list order, each with a reused hook context,
   * until a step returns true; returns whether one did. The list is gathered first, so hooks that remove auras are
   * safe, and an aura gone before its turn is passed over. Nothing is allocated.
   */
  eachHook<S>(walk: HookWalk<G, S>, subject: S): boolean {
    const unit = walk.unit(subject);

    if (unit === undefined) {
      return false;
    }

    const list = this.lists.take();
    const count = this.auras.collect(unit, walk.hook, list);

    try {
      for (let i = 0; i < count; i++) {
        const aura = list[i];

        if (aura?.isActive === true && this.#visitOne(walk, subject, { unit, aura })) {
          return true;
        }
      }

      return false;
    } finally {
      this.lists.give(count);
    }
  }

  /** Runs procs a hook returned, through the host. */
  runProcs(procs: readonly G['proc'][] | undefined, ctx: AuraContext<G>): void {
    if (procs !== undefined && procs.length > 0) {
      (this.host.run ?? missing('run'))(procs, ctx);
    }
  }

  /** Takes the next nesting level, or refuses when the pipelines are nested too deep. */
  enter(): boolean {
    if (this.depth >= this.maxDepth) {
      return false;
    }

    this.depth += 1;

    return true;
  }

  /** Leaves a nesting level. */
  leave(): void {
    this.depth -= 1;
  }

  /** The blow record of the current level. */
  blowRecord(target: G['bearer']): BlowRecord<G> {
    return (this.blows[this.depth] ??= new BlowRecord<G>(target, this.defaultKind));
  }

  /** The heal record of the current level. */
  healRecord(target: G['bearer']): HealRecord<G> {
    return (this.heals[this.depth] ??= new HealRecord<G>(target));
  }

  /** The force record of the current level. */
  forceRecord(target: G['bearer']): ForceRecord<G> {
    return (this.forces[this.depth] ??= new ForceRecord<G>(target));
  }

  /** The death record of the current level. */
  deathRecord(unit: G['bearer']): DeathRecord<G> {
    return (this.deaths[this.depth] ??= new DeathRecord<G>(unit));
  }

  /** Runs a game heal stage. */
  healStage(run: HealStage<G>, heal: HealState<G>): 'blocked' | undefined {
    return run(heal, this.system);
  }

  /** Runs a game force stage. */
  forceStage(run: ForceStage<G>, force: ForceState<G>): 'ignored' | undefined {
    return run(force, this.system);
  }

  /** Runs a game damage stage. */
  damageStage(run: DamageStage<G>, blow: BlowRecord<G>): BlowStop | undefined {
    return run(blow, this.system);
  }

  /** Runs one walk step for one aura inside a taken hook context. */
  #visitOne<S>(
    walk: HookWalk<G, S>,
    subject: S,
    at: { readonly unit: G['bearer']; readonly aura: ActiveAura<G> },
  ): boolean {
    const ctx = this.auras.takeContext(at.unit, at.aura);

    try {
      return walk.step(subject, at.aura, ctx);
    } finally {
      this.auras.giveContext();
    }
  }
}

/**
 * One walk over the auras with a pipeline hook (`DamageEngine.eachHook`): the hook, whose auras it walks, and the step
 * run for each. Walks are made once per system, so a blow creates no closure.
 */
export interface HookWalk<G extends DamageTypes, S> {
  /** The hook. */
  readonly hook: AuraPipelineHook;

  /** The unit whose auras are walked, or `undefined` to walk none. */
  readonly unit: (subject: S) => G['bearer'] | undefined;

  /** The step for one aura; true stops the walk. */
  readonly step: (subject: S, aura: ActiveAura<G>, ctx: AuraContext<G>) => boolean;
}
