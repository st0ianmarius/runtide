/**
 * The AI toolkit: what every creature brain is built from, kept small and general. Named timers on a
 * timing wheel (`defineTimers`, `ai.start`, `ai.step`), one weighted spell picker reading each spell's
 * cast rules (`ai.pick`, `ai.first`), and a focus procs may set. Reactions, budgets, target policies and movement
 * are the game's: a brain combines these parts as it needs.
 */

export type { AiBearer, AiTypes, TimerId } from './ai-types.ts';
export { type BrainState, NO_BRAIN } from './brain.ts';
export type { PickOptions } from './picker.ts';

export {
  type AiProcKinds,
  type AiProcs,
  cancelTimer,
  type CancelTimerProc,
  setFocus,
  type SetFocusProc,
  setTimer,
  type SetTimerProc,
} from './procs.ts';

export { type AiSystem, type AiSystemOptions, createAiSystem } from './system.ts';
export { defineTimers, type TimerTable } from './timers.ts';
