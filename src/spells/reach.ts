import type { Vec2 } from '../math/index.ts';
import type { CastSeconds } from './activation.ts';
import type { GateAnswer } from './cast-request.ts';
import type { Cast } from './cast.ts';
import type { SpellEngine } from './engine.ts';
import type { AnySpellDef, SpellContext, StatsSource } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/**
 * A cast's reach rules, asked right after its target is picked, in order: how far the target may be (`range`) and how
 * near (`minRange`), whether a clear line to it is needed (`sight`), and the game's own rule over the picked target
 * (`allows`: a facing arc, an execute threshold, room at a placed point). A refusal names the rule (`range`, `close`,
 * `sight`, `reach` or the game's reason), which an `auto` clock answers as it answers no target (its `auto` clock's
 * `next`). The target's point is `pointOf`'s, else the host's (`pointOf`), else the target itself when it is a point.
 */
export interface Reach<G extends SpellTypes, Source extends StatsSource<G> = StatsSource<G>, Target = unknown> {
  /** The farthest the target's point may be from the caster's, centre to centre: a number, or read from the cast. */
  readonly range?: CastSeconds<G, Source>;

  /** The nearest the target's point may be (a charge's run-up): a number, or read from the cast; none when absent. */
  readonly minRange?: CastSeconds<G, Source>;

  /** Whether the static world must hold a clear line from the caster to the target's point (`lineClear`). */
  readonly sight?: boolean;

  /** The target's point, when neither the host nor the target itself gives one. */
  pointOf?(this: void, target: Target): Vec2;

  /**
   * The game's own rule over the picked target, asked last: false refuses as `reach`, one of the game's reasons for
   * that reason (a target not in front, one above the execute threshold).
   */
  allows?(this: void, ctx: SpellContext<G, Source, Target>, target: Target): GateAnswer<G>;
}

/** A spell's reach resolved at load. */
export interface ReachPlan<G extends SpellTypes> {
  /** The range, or `undefined` for none. */
  readonly range: CastSeconds<G> | undefined;

  /** The least range, or `undefined` for none. */
  readonly minRange: CastSeconds<G> | undefined;

  /** Whether a clear line is needed. */
  readonly sight: boolean;

  /** The spell's own point of a target, or `undefined`. */
  readonly pointOf: ((target: unknown) => Vec2) | undefined;

  /** The game's rule over the picked target, or `undefined`. */
  readonly allows: ((ctx: SpellContext<G>, target: unknown) => GateAnswer<G>) | undefined;
}

/** Why a reach rule refused a cast: out of `range`, too `close`, out of `sight`, or the game's `allows` (`reach`). */
export type ReachRefusal = 'range' | 'close' | 'sight' | 'reach';

/** Throws for a range that is not sound. */
const checkRule = <G extends SpellTypes>(rule: ReachPlan<G>, name: string): void => {
  const { range, minRange } = rule;

  if ((typeof range === 'number' && !(range >= 0)) || (typeof minRange === 'number' && !(minRange >= 0))) {
    throw new RangeError(`Spell ${name}: its range takes a distance from 0.`);
  }
};

/** A spell's own reach. */
const ruleOf = <G extends SpellTypes>(own: Reach<G>): ReachPlan<G> => ({
  range: own.range,
  minRange: own.minRange,
  sight: own.sight ?? false,
  pointOf: own.pointOf,
  allows: own.allows
});

/**
 * Resolves a spell's reach, or `undefined` when it has none. Throws for a reach on a spell with no target, and a
 * range not sound.
 */
export const reachOf = <G extends SpellTypes>(def: AnySpellDef<G>, name: string): ReachPlan<G> | undefined => {
  if (def.reach === undefined) {
    return undefined;
  }

  if (def.target === undefined) {
    throw new RangeError(`Spell ${name}: its reach is checked against its target, so it needs a target hook.`);
  }

  const rule = ruleOf(def.reach);

  checkRule(rule, name);

  const isEmpty = rule.range === undefined && rule.minRange === undefined && !rule.sight && rule.allows === undefined;

  return isEmpty ? undefined : Object.freeze(rule);
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
    `Spell ${engine.registry.name(cast.spell)}: its reach needs its target's point (reach.pointOf or host.pointOf).`
  );
};

/** The squared distance from `from` to `to`. */
const distanceSq = ([from, to]: readonly [Vec2, Vec2]): number => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  return dx * dx + dz * dz;
};

/** A distance read from the cast: a constant, or its function of the cast. */
const distanceOf = <G extends SpellTypes>(distance: CastSeconds<G>, cast: Cast<G>): number =>
  typeof distance === 'function' ? distance(cast) : distance;

/** The point the caster's position is read into, read at once. */
const FROM = { x: 0, z: 0 };

/** The refusal of the distance rules (`range`, `minRange`) and `sight`, or `undefined`. */
const placedRefusal = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  plan: ReachPlan<G>
): ReachRefusal | undefined => {
  if (plan.range === undefined && plan.minRange === undefined && !plan.sight) {
    return undefined;
  }

  const to = targetPoint(engine, plan, cast);
  const from = (engine.host.positionOf ?? noPosition)(cast.caster, FROM);
  const gap = distanceSq([from, to]);

  if (plan.range !== undefined && gap > distanceOf(plan.range, cast) ** 2) {
    return 'range';
  }

  if (plan.minRange !== undefined && gap < distanceOf(plan.minRange, cast) ** 2) {
    return 'close';
  }

  return plan.sight && !engine.world.lineClear(from, to) ? 'sight' : undefined;
};

/** A cast's reach rules against its picked target, in order: range, least range, sight, the game's. */
export const checkReach = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  cast: Cast<G>,
  plan: ReachPlan<G>
): ReachRefusal | G['refusal'] | undefined => {
  const placed = placedRefusal(engine, cast, plan);

  if (placed !== undefined || plan.allows === undefined) {
    return placed;
  }

  const answer = plan.allows(cast, cast.target);

  if (answer === true) {
    return undefined;
  }

  return answer === false ? 'reach' : answer;
};

/** The host has no `positionOf`: the load check prevents it. */
const noPosition = (): never => {
  throw new TypeError('A reach rule needs host.positionOf.');
};
