import type { StatView } from '../modifiers/index.ts';
import type { WorldQuery } from '../world/index.ts';
import type { SpellTypes } from './spell-types.ts';

/**
 * What a mirror-safe hook may read of the static world (§II.2, §II.6 R3): lines of sight, clearance, clamping and body
 * moves against geometry that never moves, which a prediction mirror has exactly as the server does.
 */
export type StaticWorld = Pick<WorldQuery<unknown>, 'lineClear' | 'isPositionClear' | 'clamp' | 'moveBody' | 'bounds'>;

/**
 * What a hook the prediction mirror runs may read (§II.2 "mirror-safe by type", §II.3.9): the bearer, the input it
 * was handed, its synced stats, the static world and the step. No random stream, no other unit and no server state,
 * so a hook typed over it cannot reach them: the compiler holds the rule, not a test. A button's motion half
 * (`activate`, `travel`) receives one; it is reused, so a hook reads it while it runs and never keeps it.
 */
export interface MirrorCtx<G extends SpellTypes> {
  /** The bearer the hook moves or reads (its body, its predicted auras). */
  readonly bearer: G['bearer'];

  /** What the press handed it: an aim, a direction; `undefined` on a step with no press. */
  readonly input: G['input'] | undefined;

  /** The bearer's synced stats, as the mirror folds them; `undefined` when it has none. */
  readonly stats: StatView | undefined;

  /** The static world. */
  readonly world: StaticWorld;

  /** The step, in seconds. */
  readonly dt: number;
}

/** A mirror-safe hook: a function of `MirrorCtx` only, run alike on the server and on a prediction mirror. */
export type MirrorHook<G extends SpellTypes, Result = void> = (ctx: MirrorCtx<G>) => Result;
