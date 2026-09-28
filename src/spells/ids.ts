/**
 * The spell system's branded handles (§I.5): plain numbers at runtime. This file is one of the few that may cast
 * (§I.4.2), because a brand can only be put on a number by an assertion.
 */
import type { Handle } from '../core/index.ts';

/** A cast in flight, as a generational handle: stale (and refused) once the cast is over and its slot reused. */
export type CastHandle = Handle<'cast'>;

/** Brands a packed pool handle as a cast handle. Only the spell system calls it. */
export const toCastHandle = (packed: number): CastHandle => packed as CastHandle;

/** No cast: what a refused cast reports, and never a live handle (a pool's slot 0 at generation 0). */
export const NO_CAST: CastHandle = toCastHandle(0);
