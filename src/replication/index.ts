/**
 * Replication contracts (§I.6 Replication, §II.6 R4): what the wire carries, as ids and numbers. Wire tables pin each
 * registry's ids append-only; aura views tell their lifecycle ends apart; area trigger kinds declare what of them
 * replicates. No schema library: the game's transport encodes the numbers.
 */

export { auraChanges, type AuraLifecycle, auraLifecycle, type AuraViewChange } from './lifecycle.ts';
export { defineProjection, type ProjectionSpec, type StatProjection } from './projection.ts';
export { checkWireTable, type WireSource, type WireTable, wireTableOf } from './wire.ts';
