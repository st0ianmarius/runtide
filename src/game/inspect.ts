// Run once a tick (digest) or once a tick in tests (audit): indexed loops over a reused unit list, nothing allocated
// unless a problem is found.
import type { AiSystem } from '../ai/index.ts';
import type { AreaTriggerSystem } from '../area-triggers/index.ts';
import type { AuraSystem } from '../auras/index.ts';
import type { CombatLog } from '../combat-log/index.ts';
import { toId } from '../core/ids.ts';
import { digest, DIGEST_START, digestText, type SimClock, type StreamTable, type TickSlotId } from '../core/index.ts';
import type { SpellSystem } from '../spells/index.ts';
import type { UnitSystem } from '../units/index.ts';
import type { GameTypes } from './spec.ts';

/** What a game's digest and audit read. */
export interface InspectedParts<G extends GameTypes> {
  /** The fixed-step clock. */
  readonly clock: SimClock;

  /** The aura system. */
  readonly auras: AuraSystem<G>;

  /** The spell system. */
  readonly spells: SpellSystem<G>;

  /** The AI system. */
  readonly ai: AiSystem<G>;

  /** The unit system. */
  readonly units: UnitSystem<G>;

  /** The area trigger system, if any. */
  readonly areas: AreaTriggerSystem<G> | undefined;

  /** Folds the world, if the game has one that folds. */
  readonly world: ((hash: number) => number) | undefined;

  /** The stream table, if the game gave one. */
  readonly streams: Pick<StreamTable<G['stream']>, 'save'> | undefined;

  /** The combat log, if any. */
  readonly combatLog: CombatLog | undefined;
}

/** A tick slot id from its index. */
const slotOf = (index: number): TickSlotId => toId<'tickSlots'>(index);

/** A game's digest and end-of-tick audit, over one reused unit list. */
export class Inspector<G extends GameTypes> {
  readonly #parts: InspectedParts<G>;
  readonly #list: G['bearer'][] = [];
  readonly #problems: string[] = [];

  constructor(parts: InspectedParts<G>) {
    this.#parts = parts;
  }

  /** The whole game's digest (`Game.digest`). */
  readonly digest = (): number => {
    const { auras, spells, ai, units, areas, world, streams, combatLog } = this.#parts;
    const list = this.#list;
    const count = units.list(list);
    let hash = units.digest(DIGEST_START);

    for (let i = 0; i < count; i++) {
      const unit = list[i];

      if (unit !== undefined) {
        hash = ai.digest(unit, spells.digest(unit, auras.digest(unit, hash)));
      }
    }

    hash = world === undefined ? hash : world(hash);
    hash = areas === undefined ? hash : areas.digest(hash);
    hash = spells.digestDelayed(hash);
    hash = streams === undefined ? hash : digestStreams(hash, streams.save());

    return combatLog === undefined ? hash : digestText(hash, combatLog.checksum());
  };

  /** Throws one `Error` listing every step the tick missed or repeated (`Game.audit`). */
  readonly audit = (): void => {
    const { clock, spells, ai, units, areas } = this.#parts;
    const problems = this.#problems;
    const list = this.#list;
    const count = units.list(list);

    problems.length = 0;

    for (let i = 0; i < count; i++) {
      const unit = list[i];

      if (unit !== undefined) {
        this.#auditUnit(unit);
      }
    }

    this.#auditSlots('spells.stepDelayed', spells.delayedSlots, spells.delayedStepped);

    if (areas !== undefined) {
      this.#auditSlots('areas.step', areas.slots, areas.stepped);
    }

    if (ai.steppedTick !== clock.tick && ai.collectedTick !== clock.tick) {
      problems.push('neither ai.step nor scripts.collect ran');
    }

    if (problems.length > 0) {
      throw new Error(`Game audit, tick ${clock.tick}: ${problems.join('; ')}.`);
    }
  };

  /** Notes each tick slot a stepper did not step this tick. */
  #auditSlots(stepper: string, slots: number, stepped: (slot: TickSlotId) => boolean): void {
    for (let slot = 0; slot < slots; slot++) {
      if (!stepped(slotOf(slot))) {
        this.#problems.push(`${stepper} did not run for slot ${slot}`);
      }
    }
  }

  /** Notes each of a unit's steps that did not run exactly once this tick. */
  #auditUnit(unit: G['bearer']): void {
    const { auras, spells } = this.#parts;
    const problems = this.#problems;
    const { names } = auras.clockTable;

    for (let i = 0; i < names.length; i++) {
      const clock = names[i];
      const ticks = clock === undefined ? 1 : auras.tickCount(unit, clock);

      if (ticks !== 1) {
        problems.push(`unit ${unit.id}'s auras ticked ${ticks} times on clock ${clock ?? i}, not once`);
      }
    }

    const steps = spells.stepCount(unit);

    if (steps !== 1) {
      problems.push(`unit ${unit.id}'s spells.step ran ${steps} times, not once`);
    }

    const autoSteps = spells.autoStepCount(unit);

    if (autoSteps !== 1) {
      problems.push(`unit ${unit.id}'s spells.stepAuto ran ${autoSteps} times, not once`);
    }
  }
}

/** Folds a stream table's saved states into a digest, each stream by its name and state, in the table's order. */
const digestStreams = (hash: number, saved: Readonly<Partial<Record<string, number>>>): number => {
  let next = hash;

  for (const [name, state] of Object.entries(saved)) {
    next = digest(digestText(next, name), state ?? Number.NaN);
  }

  return next;
};
