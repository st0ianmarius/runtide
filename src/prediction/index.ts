/**
 * Prediction contracts (§I.6 Prediction, §II.6 R3): what a client's prediction mirror may run and read. Mirror-safe
 * hooks are typed over `MirrorCtx`; the auras the mirror reads are `predicted` and seeded from the wire
 * (`auras.seed`), and `checkPredicted` holds that rule over a game's registries.
 */

export type { CosmeticWorld, MirrorCtx, MirrorHook, StaticWorld } from './mirror.ts';

export {
  checkPredicted,
  type MotionReads,
  type PredictedReport,
  type PredictedRuleOptions,
  type ReadReason,
  type UnpredictedRead,
} from './predicted-rule.ts';
