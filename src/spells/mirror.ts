import type { Vec2 } from '../math/index.ts';
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

/** A static world with no geometry and no bounds: every line is clear and every move is made in full. */
export const OPEN_WORLD: StaticWorld = Object.freeze({
  bounds: Object.freeze({
    minX: Number.NEGATIVE_INFINITY,
    minZ: Number.NEGATIVE_INFINITY,
    maxX: Number.POSITIVE_INFINITY,
    maxZ: Number.POSITIVE_INFINITY,
  }),

  lineClear: () => true,
  isPositionClear: () => true,
  clamp: (p: Vec2) => p,
  moveBody: ([, to]: readonly [Vec2, Vec2]) => ({ position: to, hit: false, share: 1 }),
});

/** A mirror context a system reuses for every mirror-safe hook it runs (they never nest); set it, then hand it over. */
export class MirrorContext<G extends SpellTypes> implements MirrorCtx<G> {
  bearer: G['bearer'];
  input: G['input'] | undefined = undefined;
  stats: StatView | undefined = undefined;
  readonly world: StaticWorld;
  dt = 0;

  constructor(world: StaticWorld, bearer: G['bearer']) {
    this.world = world;
    this.bearer = bearer;
  }
}
