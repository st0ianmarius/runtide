import { type BlowPayload, type BlowView, createCombatLog, createDamageMeter } from '../src/combat-log/index.ts';
import { createBus, createClock } from '../src/core/index.ts';

/** A bench unit: an entity id. */
interface Unit {
  /** Its entity id. */
  readonly id: number;
}

/** How many entries the bench logs read, so no call is optimised away. */
export const logCounter = { seen: 0 };

const ATTACKER: Unit = { id: 1 };
const TARGET: Unit = { id: 100 };

/** One landed blow, as the log reads it. */
const BLOW: BlowView<Unit, number> = {
  target: TARGET,
  attacker: ATTACKER,
  source: 1,
  spell: 3,
  kind: 0,
  base: 40,
  amount: 32,
  dealt: 32,
  absorbed: 4,
  mitigated: 8,
  status: 'landed',
  isCrit: true,
  crushing: 0,
  hasKilled: false,
  isDeathPrevented: false,
  outcome: 'crit',
};

const CLOCK = createClock({ dt: 1 / 30 });

/** A bus with one damage kind, and a log over it; with a meter subscribed when asked. */
const logged = (withMeter: boolean) => {
  const bus = createBus({ taken: (): BlowPayload<Unit, number> => ({ blow: undefined }) });

  const log = createCombatLog<Unit, number>({
    bus,
    clock: CLOCK,
    idOf: (unit) => unit.id,
    damage: { taken: bus.kind.taken },
  });

  const meter = withMeter ? createDamageMeter(log) : undefined;
  const payload = { blow: BLOW };

  return () => {
    bus.raise(bus.kind.taken, payload);
    logCounter.seen += log.total & 1;
    logCounter.seen += (meter?.damageBy(1) ?? 0) > 0 ? 1 : 0;
  };
};

/** The F11 combat log benchmark tasks, and how many operations each call of its function is. */
export const LOG_TASKS: readonly (readonly [string, () => void, number])[] = [
  ['combat log: a blow raised and recorded', logged(false), 1],
  ['combat log: a blow recorded, a meter subscribed', logged(true), 1],
];
