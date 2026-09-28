import type { AuraSystem } from '../auras/index.ts';
import type { Random } from '../core/index.ts';
import type { CueBuffer } from '../cues/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { SpellClock, SpellSystem } from '../spells/index.ts';
import type { WorldQuery } from '../world/index.ts';
import type { AreaTriggerHost } from './area-host.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';
import type { AreaTriggerEvents } from './events.ts';

/** What an area trigger system is built from (§I.5): the game's kinds, the systems they run on, the world and host. */
export interface AreaTriggerSystemBase<G extends AreaTriggerTypes> {
  /** The game's area trigger kinds (`defineAreaTriggers`). */
  readonly registry: AreaTriggerRegistry<G>;

  /** The spell system: an area trigger belongs to the cast that spawned it, and runs its procs as that cast's. */
  readonly spells: SpellSystem<G>;

  /** The aura system owner auras land through (the proc system's). */
  readonly auras: AuraSystem<G>;

  /**
   * The proc system every hook's procs run through, or a function returning it: the proc registry lists the area
   * trigger system's own kinds, so a game builds this system first and hands it the proc system late.
   */
  readonly procs: ProcSystem<G> | (() => ProcSystem<G>);

  /** The world area triggers ask (their shapes' units, their sweeps). */
  readonly world: WorldQuery<G['bearer']>;

  /** The fixed-step clock lifetimes count on (a core `SimClock`). */
  readonly clock: SpellClock;

  /** The host: the framework services and the game's own. */
  readonly host: AreaTriggerHost<G> & G['host'];

  /** The system's own random stream, which `c.random()` without a name draws from. */
  readonly random?: Random;

  /** The host's named streams, which `c.random(name)` draws from, keyed by the area trigger's key. */
  readonly streams?: (stream: G['stream'], key: readonly number[]) => Random;

  /** The bus and event kinds area trigger events are raised on. */
  readonly events?: AreaTriggerEvents<G>;

  /** The buffer area trigger cues fire into; required when any kind has cues. */
  readonly cues?: CueBuffer;

  /** The game's tick slots (`defineTickSlots`); one slot when absent. */
  readonly slots?: {
    /** How many slots there are. */
    readonly size: number;
  };

  /** Clears the game's fields of an area trigger as its slot goes back to the pool. */
  readonly resetExt?: (ext: G['areaExt']) => void;
}

/**
 * The options of an area trigger system: its base, and `createExt`, which makes the game's fields for each pooled area
 * trigger. It is required exactly when the game's `areaExt` type does not admit `undefined`.
 */
export type AreaTriggerSystemOptions<G extends AreaTriggerTypes> = AreaTriggerSystemBase<G> &
  (undefined extends G['areaExt']
    ? {
        /** Makes the game's fields of a pooled area trigger; they stay `undefined` when absent. */
        readonly createExt?: () => G['areaExt'];
      }
    : {
        /** Makes the game's fields of a pooled area trigger. */
        readonly createExt: () => G['areaExt'];
      });
