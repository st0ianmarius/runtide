/**
 * Prediction contracts: what a client's prediction mirror may run and read. Mirror-safe
 * hooks are typed over `MirrorCtx` (in `spells`, which a button's motion half names); the auras the mirror reads are `predicted` and seeded from the wire
 * (`auras.seed`), and `checkPredicted` holds that rule over a game's registries.
 */

export {
  checkPredicted,
  type MotionReads,
  type PredictedReport,
  type PredictedRuleOptions,
  type ReadReason,
  type UnpredictedRead,
} from './predicted-rule.ts';
