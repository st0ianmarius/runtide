/**
 * Prediction contracts: what a client's prediction mirror may run and read. Mirror-safe
 * hooks are typed over `MirrorCtx` (in `spells`, which a button's motion half names); the auras the mirror reads are `predicted` and seeded from the wire
 * (`auras.seed`), and `checkPredicted` holds that rule over a game's registries.
 *
 * The motion contract: a mirror steps its motion clock once per input it consumes (its presses through
 * `abilities.tryActivate`, its own motion step), and the server steps that unit's motion once per input it consumes as
 * well. Neither steps a gap with no input: the server waits on a missing input until the game's stall threshold, and
 * only then steps without one. So the mirror and the server run the same steps on the same inputs, step for step, and
 * a replay from an acknowledged input lands where the server did.
 */

export {
  checkPredicted,
  type MotionReads,
  type PredictedReport,
  type PredictedRuleOptions,
  type ReadReason,
  type UnpredictedRead
} from './predicted-rule.ts';
