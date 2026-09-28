/**
 * The version of spellweave's public contracts: the exported types, hooks and their documented behaviour. It stays 0
 * while the framework is being built, becomes 1 when the first milestone is complete, and rises by one with every
 * later breaking change, so a consumer that pins a commit can assert the contract it was written against.
 */
export const CONTRACT_VERSION = 0;

export * from './core/index.ts';
