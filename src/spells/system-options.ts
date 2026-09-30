import type { AuraSystem } from '../auras/index.ts';
import type { Random } from '../core/index.ts';
import type { CueBuffer } from '../cues/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { SpellClock } from './engine.ts';
import type { SpellEvents } from './events.ts';
import type { StaticWorld } from './mirror.ts';
import type { SpellHost } from './spell-host.ts';
import type { SpellTypes } from './spell-types.ts';

/** What a spell system is built from: the game's spells, the systems they run on, the clock and the host. */
export interface SpellSystemBase<G extends SpellTypes> {
  /** The game's spells (`defineSpells`). */
  readonly registry: SpellRegistry<G>;

  /** The aura system cooldowns land through (the proc system's). */
  readonly auras: AuraSystem<G>;

  /**
   * The proc system every hook's procs run through, or a function returning it: the proc registry lists the spell
   * system's own kinds, so a game builds the spell system first and hands it the proc system late.
   */
  readonly procs: ProcSystem<G> | (() => ProcSystem<G>);

  /** The fixed-step clock every stage counts on (a core `SimClock`). */
  readonly clock: SpellClock;

  /** The host: the framework services and the game's own. */
  readonly host: SpellHost<G> & G['host'];

  /** The spells' own random stream, which `ctx.random()` without a name draws from. */
  readonly random?: Random;

  /**
   * The host's named streams (a `StreamTable`'s `random`), which `ctx.random(name)` draws from: a keyed name draws
   * keyed rolls over the cast's key (`(startTick, casterId, spellId, targetId, index, ordinal)`, the ordinal counting the casts its caster started on that tick).
   */
  readonly streams?: (stream: G['stream'], key: readonly number[]) => Random;

  /** The bus and event kinds spell events are raised on. */
  readonly events?: SpellEvents<G>;

  /** The buffer spell cues fire into; required when any spell has cues. */
  readonly cues?: CueBuffer;

  /**
   * The static world a spell's mirror-safe cast cue (`MirrorCtx.world`) and its reach's sight and room read; an open
   * one when absent, and required by a reach that tests sight or room.
   */
  readonly world?: StaticWorld;

  /**
   * Every interrupt the game raises, so a caster holds one (`isInterrupted`) even when no spell's timeline
   * names it: an area trigger pausing while its owner is frozen. The timelines' own are added after them.
   */
  readonly interrupts?: readonly G['interrupt'][];

  /** The game's tick slots (`defineTickSlots`), each with its own delayed procs; one slot when absent. */
  readonly slots?: {
    /** How many slots there are. */
    readonly size: number;
  };

  /** Clears the game's fields of a cast as its slot goes back to the pool. */
  readonly resetExt?: (ext: G['castExt']) => void;
}

/**
 * The options of a spell system: its base, and `createExt`, which makes the game's fields for each pooled cast. It is
 * required exactly when the game's `castExt` type does not admit `undefined`.
 */
export type SpellSystemOptions<G extends SpellTypes> = SpellSystemBase<G> &
  (undefined extends G['castExt']
    ? {
        /** Makes the game's fields of a pooled cast; they stay `undefined` when absent. */
        readonly createExt?: () => G['castExt'];
      }
    : {
        /** Makes the game's fields of a pooled cast. */
        readonly createExt: () => G['castExt'];
      });
