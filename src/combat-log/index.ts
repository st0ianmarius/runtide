/**
 * The combat log: a structured stream of every blow, immunity, heal, death, force, aura change, cast moment and
 * area trigger spawn and end, recorded from the systems' bus events as ids and numbers into a ring, with subscribers
 * (a damage meter, tests, analytics) and a checksum for goldens.
 */

export { type CombatEntry, type CombatEntryKind, ENTRY_CRIT, ENTRY_DEATH_PREVENTED, ENTRY_KILLED } from './entry.ts';

export {
  type CombatLog,
  type CombatLogBus,
  type CombatLogListener,
  type CombatLogOptions,
  createCombatLog
} from './log.ts';

export { createDamageMeter, type DamageMeter, type MeterRow, type SpellMeterRow } from './meter.ts';

export { FORCE_KINDS } from './recorders.ts';

export type {
  AreaEventView,
  AreaLogEvents,
  AuraEventView,
  BlowPayload,
  BlowView,
  DamageLogEvents,
  DeathPayload,
  DeathView,
  ForcePayload,
  ForceView,
  HealPayload,
  HealView,
  SpellEventView,
  SpellLogEvents
} from './views.ts';
