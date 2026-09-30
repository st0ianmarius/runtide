import type { Vec2 } from '../math/index.ts';
import type { CastSeconds } from './activation.ts';
import type { Cast } from './cast.ts';
import type { SpellEngine } from './engine.ts';
import type { AnySpellDef, StatsSource } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/**
 * A cast's reach rules (§I.7.1 F16), asked right after its target is picked: how far the target may be (`range`),
 * whether a clear line to it is needed (`sight`), and how much room its point needs (`clearance`: a placement, the
 * Sentry's). A refusal names the rule (`range`, `sight`, `placement`), which an `auto` clock answers as it answers no
 * target (its `auto` clock's `next`). The target's point is `pointOf`'s, else the host's (`pointOf`), else the target itself when it
 * is a point.
 */
export interface Reach<G extends SpellTypes, Source extends StatsSource<G> = StatsSource<G>, Target = unknown> {
  /** The farthest the target's point may be from the caster's, centre to centre: a number, or read from the cast. */
  readonly range?: CastSeconds<G, Source>;

  /** Whether the static world must hold a clear line from the caster to the target's point (`lineClear`). */
  readonly sight?: boolean;

  /** The radius of a body that must fit at the target's point (`isPositionClear`); none when absent or 0. */
  readonly clearance?: number;

  /** The target's point, when neither the host nor the target itself gives one. */
  pointOf?(this: void, target: Target): Vec2;
}

/** The reach an activation kind supplies where the spell declares none (an `ai` activation's `range` and `sight`). */
export interface ReachDefaults {
  /** The farthest the target may be. */
  readonly range?: number | undefined;

  /** Whether a clear line to it is needed. */
  readonly sight?: boolean | undefined;
}

/** A spell's reach resolved at load: its own rules over its activation's defaults. */
export interface ReachPlan<G extends SpellTypes> {
  /** The range, or `undefined` for none. */
  readonly range: CastSeconds<G> | undefined;

  /** Whether a clear line is needed. */
  readonly sight: boolean;

  /** The radius that must fit at the point; 0 for none. */
  readonly clearance: number;

  /** The spell's own point of a target, or `undefined`. */
  readonly pointOf: ((target: unknown) => Vec2) | undefined;
}

/** Why a cast's reach refused it. */
export type ReachRefusal = 'range' | 'sight' | 'placement';

/** Throws for a range or clearance that is not sound. */
const checkRule = <G extends SpellTypes>(rule: ReachPlan<G>, name: string): void => {
  const { range, clearance } = rule;

  if (typeof range === 'number' && !(range >= 0)) {
    throw new RangeError(`Spell ${name}: its range takes a distance from 0.`);
  }

  if (!(clearance >= 0) || !Number.isFinite(clearance)) {
    throw new RangeError(`Spell ${name}: its clearance takes a finite radius from 0.`);
  }
};

/** A spell's own reach over its activation's defaults. */
const ruleOf = <G extends SpellTypes>(
  own: Reach<G> | undefined,
  defaults: ReachDefaults | undefined,
): ReachPlan<G> => ({
  range: own?.range ?? defaults?.range,
  sight: own?.sight ?? defaults?.sight ?? false,
  clearance: own?.clearance ?? 0,
  pointOf: own?.pointOf,
});

/**
 * Resolves a spell's reach, or `undefined` when it has no rule or no target hook (an activation's defaults apply only
 * to a spell that picks a target). Throws for a reach on a spell with no target, and a range or clearance not sound.
 */
export const reachOf = <G extends SpellTypes>(
  def: AnySpellDef<G>,
  defaults: ReachDefaults | undefined,
  name: string,
): ReachPlan<G> | undefined => {
  if (def.target === undefined) {
    if (def.reach !== undefined) {
      throw new RangeError(`Spell ${name}: its reach is checked against its target, so it needs a target hook.`);
    }

    return undefined;
  }

  const rule = ruleOf(def.reach, defaults);

  checkRule(rule, name);

  return rule.range === undefined && !rule.sight && rule.clearance === 0 ? undefined : Object.freeze(rule);
};

/** Whether a value is a point. */
const isPoint = (value: unknown): value is Vec2 =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'x') === 'number' &&
  typeof Reflect.get(value, 'z') === 'number';

/** A target's point: the spell's, the host's, or the target itself. Throws when none gives one. */
const targetPoint = <G extends SpellTypes>(engine: SpellEngine<G>, plan: ReachPlan<G>, cast: Cast<G>): Vec2 => {
  const { target } = cast;
  const point = plan.pointOf?.(target) ?? engine.host.pointOf?.(target);

  if (point !== undefined) {
    return point;
  }

  if (isPoint(target)) {
    return target;
  }

  throw new TypeError(
    `Spell ${engine.registry.name(cast.spell)}: its reach needs its target's point (reach.pointOf or host.pointOf).`,
  );
};

/** Whether a range holds: the distance from `from` to `to` is at most the range read from the cast. */
const isInRange = <G extends SpellTypes>(
  range: CastSeconds<G>,
  cast: Cast<G>,
  [from, to]: readonly [Vec2, Vec2],
): boolean => {
  const reach = typeof range === 'function' ? range(cast) : range;
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  return dx * dx + dz * dz <= reach * reach;
};

/** A cast's reach rules against its picked target, in order: range, sight, clearance. The refusal, or `undefined`. */
export const checkReach = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  plan: ReachPlan<G>,
): ReachRefusal | undefined => {
  const to = targetPoint(engine, plan, cast);

  if (plan.range !== undefined || plan.sight) {
    const from = (engine.host.positionOf ?? noPosition)(cast.caster);

    if (plan.range !== undefined && !isInRange(plan.range, cast, [from, to])) {
      return 'range';
    }

    if (plan.sight && !engine.world.lineClear(from, to)) {
      return 'sight';
    }
  }

  return plan.clearance > 0 && !engine.world.isPositionClear(to, plan.clearance) ? 'placement' : undefined;
};

/** The host has no `positionOf`: the load check prevents it. */
const noPosition = (): never => {
  throw new TypeError('A reach rule needs host.positionOf.');
};
