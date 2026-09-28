import type { EventKind } from '../core/index.ts';
import type { ProcBus } from '../procs/index.ts';
import type { TriggerEvent, TriggerTypes } from '../triggers/index.ts';
import type { Blow } from './blow.ts';
import type { BlowStatus, DamageTypes } from './damage-types.ts';
import type { Death } from './death.ts';
import type { Heal } from './heal.ts';
import type { DamageKindTable } from './kinds.ts';

/** The payload of a damage event: the blow, reused between raises, read while the listener runs. */
export interface DamageEvent<G extends DamageTypes> {
  /** The blow; set on every raise. */
  blow: Blow<G> | undefined;
}

/** The payload of a heal event: the heal, reused between raises. */
export interface HealEvent<G extends DamageTypes> {
  /** The heal; set on every raise. */
  heal: Heal<G> | undefined;
}

/** The payload of a death or kill event: the death, reused between raises. */
export interface DeathEvent<G extends DamageTypes> {
  /** The death; set on every raise. */
  death: Death<G> | undefined;
}

/** Makes an empty damage event payload: the factory a game registers `dealt` and `taken` on its bus with. */
export const createDamageEvent = <G extends DamageTypes>(): DamageEvent<G> => ({ blow: undefined });

/** Makes an empty heal event payload. */
export const createHealEvent = <G extends DamageTypes>(): HealEvent<G> => ({ heal: undefined });

/** Makes an empty death event payload. */
export const createDeathEvent = <G extends DamageTypes>(): DeathEvent<G> => ({ death: undefined });

/**
 * The bus and the event kinds the damage system raises (§I.5.6 hatch 7): generic kinds a game maps its own trigger
 * events onto. Each is optional, and raised only when something hears it.
 */
export interface DamageEvents<G extends DamageTypes> {
  /** The bus. */
  readonly bus: ProcBus;

  /** A blow that was not skipped or ignored, about its attacker (on-hit triggers); raised before `taken`. */
  readonly dealt?: EventKind<DamageEvent<G>>;

  /** A blow that was not skipped or ignored, about its target (when-struck triggers). */
  readonly taken?: EventKind<DamageEvent<G>>;

  /** A heal that was not skipped, about its target. */
  readonly healed?: EventKind<HealEvent<G>>;

  /** A death, about the unit that died, between the rewards before it and after it; never for an inert unit. */
  readonly death?: EventKind<DeathEvent<G>>;

  /** The same death, about its killer, raised right after `death`; never without a killer. */
  readonly kill?: EventKind<DeathEvent<G>>;
}

/** The blow statuses, in the code order a `status` filter's argument resolves to. */
export const BLOW_STATUSES: readonly BlowStatus[] = Object.freeze([
  'skipped',
  'ignored',
  'blocked',
  'absorbed',
  'landed',
]);

/** Resolves a status name to its code. */
const statusCode = (name: string): number => {
  const names: readonly string[] = BLOW_STATUSES;
  const code = names.indexOf(name);

  if (code < 0) {
    throw new RangeError(`unknown blow status ${name}.`);
  }

  return code;
};

/** Resolves a damage kind's name to its id, in one kind table. */
const kindCode =
  (kinds: DamageKindTable) =>
  (name: string): number => {
    const ids: Readonly<Record<string, number | undefined>> = kinds.id;
    const id = ids[name];

    if (id === undefined) {
      throw new RangeError(`unknown damage kind ${name}.`);
    }

    return id;
  };

/**
 * A damage event kind as a trigger event: about the blow's `attacker` (for `dealt`) or its `target` (for `taken`), with
 * the filters `crit` (a critical blow), `status` (by name: `blocked`, `absorbed`, `landed`), `damageKind` (by name),
 * `minAmount` (at least the argument reached health) and `crushing` (a crushing blow). A trigger names them in `when`.
 */
export const damageTriggerEvent = <G extends DamageTypes & TriggerTypes>(
  kind: EventKind<DamageEvent<G>>,
  spec: {
    /** Whose triggers answer. */
    readonly about: 'attacker' | 'target';

    /** The game's damage kinds, which the `damageKind` filter names. */
    readonly kinds: DamageKindTable<G['damageKind']>;
  },
): TriggerEvent<G> => {
  const resolveKind = kindCode(spec.kinds);

  return Object.freeze({
    kind,
    unit: (event: DamageEvent<G>) => (spec.about === 'attacker' ? event.blow?.attacker : event.blow?.target),

    filters: Object.freeze({
      crit: { test: (event: DamageEvent<G>) => event.blow?.isCrit === true },
      status: {
        test: (event: DamageEvent<G>, code: number) => event.blow?.status === BLOW_STATUSES[code],
        resolve: statusCode,
      },
      damageKind: { test: (event: DamageEvent<G>, id: number) => event.blow?.kind === id, resolve: resolveKind },
      minAmount: { test: (event: DamageEvent<G>, least: number) => (event.blow?.amount ?? 0) >= least },
      crushing: { test: (event: DamageEvent<G>) => (event.blow?.crushing ?? 0) > 0 },
    }),
  });
};

/** A heal event kind as a trigger event, about the healed unit or the healer, with the filter `minAmount`. */
export const healTriggerEvent = <G extends DamageTypes & TriggerTypes>(
  kind: EventKind<HealEvent<G>>,
  about: 'target' | 'healer',
): TriggerEvent<G> =>
  Object.freeze({
    kind,
    unit: (event: HealEvent<G>) => (about === 'healer' ? event.heal?.healer : event.heal?.target),
    filters: Object.freeze({
      minAmount: { test: (event: HealEvent<G>, least: number) => (event.heal?.amount ?? 0) >= least },
    }),
  });

/** A death or kill event kind as a trigger event, about the unit that died or its killer; no filters. */
export const deathTriggerEvent = <G extends DamageTypes & TriggerTypes>(
  kind: EventKind<DeathEvent<G>>,
  about: 'unit' | 'killer',
): TriggerEvent<G> =>
  Object.freeze({
    kind,
    unit: (event: DeathEvent<G>) => (about === 'killer' ? event.death?.killer : event.death?.unit),
    filters: Object.freeze({}),
  });
