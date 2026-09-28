import { toHandle } from '../core/ids.ts';
import { createPool, type Handle, type Pool, stepsUntil } from '../core/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaLedger, AreaLedgerSpec } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';
import { type AreaTriggerHandle, NO_AREA_TRIGGER } from './ids.ts';

/** The fewest units a `rehit` ledger holds before it forgets the cool ones. */
const PRUNE_FROM = 64;

/**
 * One hit ledger, pooled (§II.6 W3): the tick each unit (by entity id) was last hit, the claims held on units, and
 * its counts; shared by as many area triggers as its scope joins, and back to the pool when the last lets go.
 */
export class Ledger {
  /** The tick each unit was last hit on, by entity id. */
  readonly last = new Map<number, number>();

  /** Who holds a claim on each unit, by entity id. */
  readonly claims = new Map<number, AreaTriggerHandle>();

  /** Its rules. */
  spec: AreaLedgerSpec = { policy: 'once' };

  /** How many different units it recorded. */
  distinct = 0;

  /** How many hits it recorded. */
  hits = 0;

  /** How many area triggers share it. */
  refs = 0;

  /** The area trigger recording in it now, which a claim is held for. */
  holder: AreaTriggerHandle = NO_AREA_TRIGGER;

  /** How many units a `rehit` ledger holds before it forgets the ones whose cooldown ran. */
  watermark = PRUNE_FROM;

  /** Its handle in the pool. */
  handle: Handle<Ledger> = toHandle<Ledger>(0);

  /** Whether its pierce or budget ran out. */
  get isSpent(): boolean {
    const { pierce, budget } = this.spec;

    return (pierce !== undefined && this.distinct >= pierce) || (budget !== undefined && this.hits >= budget);
  }
}

/** The ledgers of one engine: the pool, and the cast-scoped ones by cast and name. */
export class LedgerBook {
  readonly #pool: Pool<Ledger> = createPool({ create: () => new Ledger() });
  readonly #byCast = new Map<number, Map<string, Ledger>>();

  /** How many ledgers are live. */
  get live(): number {
    return this.#pool.live;
  }

  /** A new ledger under a spec, held once. */
  open(spec: AreaLedgerSpec): Ledger {
    const handle = this.#pool.acquire();
    const ledger = this.#pool.get(handle) ?? new Ledger();

    ledger.handle = handle;
    ledger.spec = spec;
    ledger.refs = 1;

    return ledger;
  }

  /** The ledger a cast shares under a name, opened on first use, held once more. */
  ofCast(cast: number, [name, spec]: readonly [string, AreaLedgerSpec]): Ledger {
    let byName = this.#byCast.get(cast);

    if (byName === undefined) {
      byName = new Map();
      this.#byCast.set(cast, byName);
    }

    const shared = byName.get(name);

    if (shared !== undefined) {
      shared.refs += 1;

      return shared;
    }

    const ledger = this.open(spec);

    byName.set(name, ledger);

    return ledger;
  }

  /** Lets go of one hold, dropping the claims `holder` holds; the last hold puts it back in the pool. */
  close(ledger: Ledger, holder: AreaTriggerHandle, cast: number): void {
    for (const [unit, claimant] of ledger.claims) {
      if (claimant === holder) {
        ledger.claims.delete(unit);
      }
    }

    ledger.refs -= 1;

    if (ledger.refs > 0) {
      return;
    }

    const byName = this.#byCast.get(cast);

    for (const [name, shared] of byName ?? []) {
      if (shared === ledger) {
        byName?.delete(name);
      }
    }

    if (byName?.size === 0) {
      this.#byCast.delete(cast);
    }

    ledger.last.clear();
    ledger.claims.clear();
    ledger.distinct = 0;
    ledger.hits = 0;
    ledger.watermark = PRUNE_FROM;
    this.#pool.release(ledger.handle);
  }
}

/** Whether a unit last hit on tick `last` may be hit again under `rehit`: its cooldown has run since. */
const isCool = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, cooldown: number, last: number): boolean => {
  const { dt, countdown, tick } = engine.clock;

  return tick - last >= stepsUntil(cooldown, dt, countdown);
};

/**
 * The share its policy gives the ledger's holder's hit on a unit last hit on tick `last` (`undefined`: never), 0 when
 * it refuses it: `claim` lets through whoever holds the unit's claim (anyone when nobody does), the rest always a first
 * hit, and then `repeat` its share and `rehit` a full hit once its cooldown ran.
 */
const policyShare = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, ledger: Ledger, unit: number): number => {
  const { spec } = ledger;
  const last = ledger.last.get(unit);

  if (spec.policy === 'claim') {
    const claimant = ledger.claims.get(unit);

    return claimant === undefined || claimant === ledger.holder ? 1 : 0;
  }

  if (last === undefined) {
    return 1;
  }

  if (spec.policy === 'repeat') {
    return spec.share ?? 1;
  }

  return spec.policy === 'rehit' && isCool(engine, spec.cooldown ?? 0, last) ? 1 : 0;
};

/**
 * The share the ledger's holder's hit on a unit takes now, 0 when its policy refuses it or it is spent; set the
 * ledger's `holder` first.
 */
const shareIn = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, ledger: Ledger, unit: number): number => {
  const { pierce } = ledger.spec;

  if (ledger.isSpent || (pierce !== undefined && ledger.distinct >= pierce && !ledger.last.has(unit))) {
    return 0;
  }

  return policyShare(engine, ledger, unit);
};

/**
 * Forgets the units a `rehit` ledger could hit again anyway (their cooldown ran) once it holds as many as its watermark,
 * then doubles the watermark over what is left, so a long-lived ledger (a missile orbiting through a horde) keeps a
 * bounded map. Its `distinct` count still counts them.
 */
const prune = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, ledger: Ledger): void => {
  const { spec } = ledger;

  if (spec.policy !== 'rehit' || ledger.last.size < ledger.watermark) {
    return;
  }

  for (const [unit, last] of ledger.last) {
    if (isCool(engine, spec.cooldown ?? 0, last)) {
      ledger.last.delete(unit);
    }
  }

  ledger.watermark = Math.max(PRUNE_FROM, ledger.last.size * 2);
};

/**
 * Records the ledger's holder's hit on a unit (and its claim under `claim`); returns its share, 0 when refused. Set the
 * ledger's `holder` first.
 */
export const recordIn = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, ledger: Ledger, unit: number): number => {
  const share = shareIn(engine, ledger, unit);

  if (share <= 0) {
    return 0;
  }

  if (!ledger.last.has(unit)) {
    ledger.distinct += 1;
  }

  ledger.hits += 1;
  prune(engine, ledger);
  ledger.last.set(unit, engine.clock.tick);

  if (ledger.spec.policy === 'claim') {
    ledger.claims.set(unit, ledger.holder);
  }

  return share;
};

/** The ledgers an area trigger opens as it spawns: its own, its cast's, or its parent's for its family. */
export const openLedgers = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  parent: AreaTrigger<G> | undefined,
): void => {
  const specs = engine.registry.get(area.kind).ledgers ?? {};

  for (const [name, spec] of Object.entries(specs)) {
    const inherited = spec.scope === 'family' ? parent?.ledgers.get(name) : undefined;

    if (inherited !== undefined) {
      inherited.refs += 1;
      area.ledgers.set(name, inherited);
    } else if (spec.scope === 'cast' && area.cast !== undefined) {
      area.ledgers.set(name, engine.ledgers.ofCast(area.castHandle, [name, spec]));
    } else {
      area.ledgers.set(name, engine.ledgers.open(spec));
    }
  }
};

/** Lets go of every ledger an area trigger holds, releasing its claims. */
export const closeLedgers = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  for (const ledger of area.ledgers.values()) {
    engine.ledgers.close(ledger, area.handle, area.castHandle);
  }

  area.ledgers.clear();
};

/** A reused view of one ledger for one area trigger: what `c.ledger(name)` returns. */
export class LedgerView<G extends AreaTriggerTypes> implements AreaLedger<G['bearer']> {
  ledger: Ledger | undefined = undefined;
  holder: AreaTriggerHandle = NO_AREA_TRIGGER;
  readonly #engine: AreaEngine<G>;

  constructor(engine: AreaEngine<G>) {
    this.#engine = engine;
  }

  get distinct(): number {
    return this.ledger?.distinct ?? 0;
  }

  get hits(): number {
    return this.ledger?.hits ?? 0;
  }

  get isSpent(): boolean {
    return this.ledger?.isSpent ?? false;
  }

  readonly has = (unit: G['bearer']): boolean => this.ledger?.last.has(this.#engine.world.idOf(unit)) ?? false;

  readonly shareOf = (unit: G['bearer']): number => {
    const { ledger } = this;

    if (ledger === undefined) {
      return 0;
    }

    ledger.holder = this.holder;

    return shareIn(this.#engine, ledger, this.#engine.world.idOf(unit));
  };

  readonly record = (unit: G['bearer']): number => {
    const { ledger } = this;

    if (ledger === undefined) {
      return 0;
    }

    ledger.holder = this.holder;

    return recordIn(this.#engine, ledger, this.#engine.world.idOf(unit));
  };

  readonly reserve = (unit: G['bearer']): boolean => {
    const id = this.#engine.world.idOf(unit);
    const claimant = this.ledger?.claims.get(id);

    if (this.ledger === undefined || (claimant !== undefined && claimant !== this.holder)) {
      return false;
    }

    this.ledger.claims.set(id, this.holder);

    return true;
  };

  readonly isClaimed = (unit: G['bearer']): boolean => {
    const claimant = this.ledger?.claims.get(this.#engine.world.idOf(unit));

    return claimant !== undefined && claimant !== this.holder;
  };
}
