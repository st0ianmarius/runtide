/**
 * The version of spellweave's public contracts: the exported types, hooks and their documented behaviour. It stays 0
 * while the framework is being built, becomes 1 when the first milestone is complete, and rises by one with every
 * later breaking change, so a consumer that pins a commit can assert the contract it was written against.
 */
export const CONTRACT_VERSION = 0;

export * from './abilities/index.ts';
export * from './area-triggers/index.ts';
export * from './auras/index.ts';
export * from './combat-log/index.ts';
export * from './conditions/index.ts';
export * from './core/index.ts';
export * from './cues/index.ts';
export * from './damage/index.ts';
export * from './math/index.ts';
export * from './modifiers/index.ts';
export * from './prediction/index.ts';
export * from './procs/index.ts';
export * from './replication/index.ts';
export * from './spells/index.ts';
export * from './triggers/index.ts';
export * from './world/index.ts';
