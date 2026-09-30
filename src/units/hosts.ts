import type { AuraApplication, AuraDecision, AuraId } from '../auras/index.ts';
import { type Bitset, createBitset } from '../core/index.ts';
import type { DamageHost } from '../damage/index.ts';
import { lateOf, type UnitEngine, unitOf } from './engine.ts';
import { moveTo } from './lifecycle.ts';
import { INERT } from './unit-def.ts';
import type { UnitTypes } from './unit-types.ts';

/**
 * A unit's maximum health moved: its health follows by the system's policy. Returns the health after. A
 * game calls it where maximum health can change (an aura landing or leaving, gear), or from a stat watch.
 */
export const syncHealth = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): number => {
  const unit = unitOf<G>(bearer);
  const before = unit.maxHealth;
  const after = engine.statsOf(bearer).total(engine.healthStat);

  if (after === before) {
    return unit.health;
  }

  unit.maxHealth = after;

  const policy = engine.options.health.policy ?? 'heal-gain-scale-loss';
  const share = before > 0 ? unit.health / before : 1;

  if (typeof policy === 'function') {
    unit.health = Math.min(policy(bearer, before, after), after);
  } else if (policy === 'keep') {
    unit.health = Math.min(unit.health, after);
  } else if (policy === 'scale' || after < before) {
    unit.health = share * after;
  } else if (engine.options.damage === undefined) {
    unit.health = Math.min(unit.health + (after - before), after);
  } else {
    lateOf(engine.options.damage).heal({ target: bearer, amount: after - before });
  }

  return unit.health;
};

/**
 * The damage host a unit system provides: health, maximum health, stats, ids, inert units (no rewards, no kill
 * event:), and a death that leaves the unit dead. A game spreads it into its damage host and adds the rest.
 */
export const damageHostOf = <G extends UnitTypes>(
  engine: UnitEngine<G>,
): Pick<
  DamageHost<G>,
  'health' | 'setHealth' | 'maxHealth' | 'statsOf' | 'idOf' | 'unitOf' | 'isInert' | 'remove'
> => ({
  health: (unit) => unitOf<G>(unit).health,

  setHealth: (unit, health) => {
    unitOf<G>(unit).health = health;
  },

  maxHealth: (unit) => unitOf<G>(unit).maxHealth,
  statsOf: (unit) => engine.statsOf(unit),
  idOf: (unit) => unitOf<G>(unit).id,
  unitOf: (id) => engine.byId.get(id),
  isInert: (unit) => ((engine.registry.traits[unitOf<G>(unit).template] ?? 0) & INERT) !== 0,

  remove: (unit) => {
    moveTo(engine, unit, ['dead', undefined]);
  },
});

/**
 * An application rule: what happens when an aura lands on a unit of some classes. The first rule whose aura
 * and classes match decides: it refuses the aura, or lands another in its place, scales and caps its length, and arms
 * an immunity aura for a share of the length it landed with (a diminishing return).
 */
export interface AuraRule<G extends UnitTypes = UnitTypes> {
  /** The aura it answers. */
  readonly aura: AuraId;

  /** The unit classes it applies to (any of them); every unit when absent. */
  readonly tags?: readonly G['unitTag'][];

  /** Whether it refuses the aura outright. */
  readonly refuse?: boolean;

  /** The aura that lands in its place (a boss takes a slow instead of a freeze). */
  readonly instead?: AuraId;

  /** What its length is multiplied by (a warrior's control × 0.75). */
  readonly scale?: number;

  /** The longest it lasts, in seconds (an elite's freeze 0.75 s). */
  readonly cap?: number;

  /** An immunity aura armed after it lands, for a share of the length it landed with (1 when absent). */
  readonly immunity?: {
    /** The immunity aura (whose tags the controlled aura's `blockedBy` names). */
    readonly aura: AuraId;

    /** Its length as a share of the landed length. */
    readonly share?: number;
  };
}

/** A rule with its classes as a bitset. */
interface CompiledRule<G extends UnitTypes> {
  readonly rule: AuraRule<G>;
  readonly tags: Bitset | undefined;
}

/** Compiles the rules' class tags at load, refusing an unknown tag and unsound numbers. */
export const compileRules = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  rules: readonly AuraRule<G>[],
): readonly CompiledRule<G>[] => {
  const ids: Readonly<Record<string, number | undefined>> = engine.registry.tags.id;

  return rules.map((rule, index) => {
    const refuse = (problem: string): never => {
      throw new RangeError(`Aura rule ${index}: ${problem}`);
    };

    if (!(rule.scale === undefined || rule.scale >= 0) || !(rule.cap === undefined || rule.cap >= 0)) {
      refuse('its scale and cap are from 0.');
    }

    const tags =
      rule.tags === undefined
        ? undefined
        : createBitset(rule.tags.map((tag) => ids[tag] ?? refuse(`there is no unit tag named ${tag}.`)));

    return { rule, tags };
  });
};

/**
 * The application policy of a unit system's rules: the aura host's `onIncomingAura`. `undefined` accepts
 * the application as it is.
 */
export const decideAura = <G extends UnitTypes>(
  engine: UnitEngine<G>,
  [rules, bearer]: readonly [readonly CompiledRule<G>[], G['bearer']],
  application: AuraApplication<G>,
): AuraDecision<G> | undefined => {
  const unit = unitOf<G>(bearer);

  const match = rules.find(
    ({ rule, tags }) => rule.aura === application.aura && (tags === undefined || tags.intersects(unit.tags)),
  )?.rule;

  if (match === undefined) {
    return undefined;
  }

  if (match.refuse === true) {
    return { refuse: true };
  }

  const aura = match.instead ?? application.aura;
  const length = application.duration ?? engine.options.auras.lengthOf(aura, bearer);
  const duration = Math.min(length * (match.scale ?? 1), match.cap ?? Infinity);
  const immunity = match.immunity;

  return {
    apply: { ...application, aura, duration },
    ...(immunity === undefined ? {} : { after: [{ aura: immunity.aura, duration: duration * (immunity.share ?? 1) }] }),
  };
};
