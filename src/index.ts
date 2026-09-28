/**
 * The version of spellweave's public contracts: the exported types, hooks and their documented behaviour. It stays 0
 * while the framework is being built, becomes 1 when the first milestone is complete, and rises by one with every
 * later breaking change, so a consumer that pins a commit can assert the contract it was written against.
 */
export const CONTRACT_VERSION = 0;

export * from './core/index.ts';
export * from './math/index.ts';
export * from './modifiers/index.ts';

// Both the math and the modifiers export `add`: at the root it stays the vector sum, and the scaled-value term helper
// is `addTerm` here (it is `add` in `spellweave/modifiers`).
export { add } from './math/index.ts';
export { add as addTerm } from './modifiers/index.ts';
