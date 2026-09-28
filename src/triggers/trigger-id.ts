import type { Id } from '../core/index.ts';

/** The id of a compiled trigger: dense, in aura order then authored order, stable while the auras are. */
export type TriggerId = Id<'triggers'>;
