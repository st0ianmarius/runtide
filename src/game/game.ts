import type { AbilitySystem } from '../abilities/index.ts';
import type { AiSystem } from '../ai/index.ts';
import type { AreaTriggerSystem } from '../area-triggers/index.ts';
import type { AuraSystem } from '../auras/index.ts';
import type { CombatLog } from '../combat-log/index.ts';
import type { EntityIds, SimClock } from '../core/index.ts';
import type { DamageSystem } from '../damage/index.ts';
import type { ModifierSystem } from '../modifiers/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { ScriptSystem } from '../scripts/index.ts';
import type { SpellSystem } from '../spells/index.ts';
import type { UnitSystem } from '../units/index.ts';
import type { MemoryWorld, WorldQuery } from '../world/index.ts';
import type { GameTypes } from './spec.ts';

/**
 * A whole game, assembled by `createGame`: every system built in the order they need each other, with every late edge
 * bound (the aura and damage hosts' `run`, the units' host members, the scripts' and procs' thunks) and the unit
 * system's wiring check passed. It does not own the tick loop: the game steps it, each tick in this order:
 *
 * 1. `clock.step()`;
 * 2. `world.tick()` (a memory world: `memoryWorld.tick()`);
 * 3. `scripts.collect()` once, or `ai.step(fire)` in a game without scripts, never both;
 * 4. each unit in a stable order (`units.list`'s ascending ids, the game's cooldown holders and bodiless world units
 *    first): `auras.tickAll(u)`, `scripts.step(u)`, its motion then its trail record, `spells.stepAuto(u)`, `spells.step(u)`;
 * 5. `areas.step(slot)` for every slot (`areas.slots`);
 * 6. `spells.stepDelayed(slot)` for every slot (`spells.delayedSlots`);
 * 7. `units.syncHealth(u)` where a unit's maximum health may have moved;
 * 8. the dead despawned, at the end of the tick;
 * 9. the combat log, the cue flush, and `digest()` where peers compare.
 *
 * `audit()` at the end of a tick checks steps 3 to 6 ran exactly once for everything.
 */
export interface Game<G extends GameTypes> {
  /** The fixed-step clock. */
  readonly clock: SimClock;

  /** The entity id space units and area triggers draw from. */
  readonly ids: EntityIds;

  /** The modifier system; `undefined` in a game without one. */
  readonly modifiers: ModifierSystem<G['bearer'], G['stat'], G['condition'], G['valueKind'], G['source']> | undefined;

  /** The aura system. */
  readonly auras: AuraSystem<G>;

  /** The spell system. */
  readonly spells: SpellSystem<G>;

  /** The AI system. */
  readonly ai: AiSystem<G>;

  /** The ability system; `undefined` in a game without one. */
  readonly abilities: AbilitySystem<G> | undefined;

  /** The world the systems query; `undefined` in a game without one. */
  readonly world: WorldQuery<G['bearer']> | undefined;

  /** The memory world `createGame` built and keeps in step with the units; `undefined` for a game's own world. */
  readonly memoryWorld: MemoryWorld<G['bearer']> | undefined;

  /** The area trigger system; `undefined` in a game without one. */
  readonly areas: AreaTriggerSystem<G> | undefined;

  /** The unit system. */
  readonly units: UnitSystem<G>;

  /** The damage system. */
  readonly damage: DamageSystem<G>;

  /** The proc system, over every system's kinds. */
  readonly procs: ProcSystem<G>;

  /** The script system; `undefined` in a game without one. */
  readonly scripts: ScriptSystem<G> | undefined;

  /** The combat log; `undefined` in a game without one. */
  readonly combatLog: CombatLog | undefined;

  /**
   * The whole game's state digest, folded in a fixed order: `units.digest`; then for each unit of `units.list` its
   * auras, spells and brain (`auras.digest`, `spells.digest`, `ai.digest`); the world (a memory world's, or the game's
   * `world.digest`); the area triggers; the delayed proc lists (`spells.digestDelayed`); the stream table's saved
   * states; the combat log's checksum. Equal for two games driven alike, it parts at the first tick they part.
   * Allocates nothing once its unit list has grown, but for the stream table's save and the combat log's checksum.
   */
  readonly digest: () => number;

  /**
   * Checks, at the end of a tick, that the tick stepped everything exactly once: each live unit's auras on every clock
   * (`auras.tickCount`), its `spells.step` and `spells.stepAuto` (`stepCount`, `autoStepCount`); every delayed slot
   * (`spells.delayedStepped`) and area trigger slot (`areas.stepped`); and the AI timers (`ai.step` or
   * `scripts.collect`, by `ai.steppedTick` and `ai.collectedTick`). Throws one `Error` listing every problem; a clean
   * tick allocates nothing.
   */
  readonly audit: () => void;
}
