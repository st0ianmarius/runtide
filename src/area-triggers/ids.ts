/**
 * The area trigger system's branded handles: plain numbers at runtime. This file is one of the few that may
 * cast, because a brand can only be put on a number by an assertion.
 */
import type { Handle } from '../core/index.ts';

/** An area trigger in the world, as a generational handle: stale (and refused) once it ended and its slot is reused. */
export type AreaTriggerHandle = Handle<'areaTrigger'>;

/** Brands a packed pool handle as an area trigger handle. Only the area trigger system calls it. */
export const toAreaTriggerHandle = (packed: number): AreaTriggerHandle => packed as AreaTriggerHandle;

/** No area trigger: what a refused spawn reports, and never a live handle (a pool's slot 0 at generation 0). */
export const NO_AREA_TRIGGER: AreaTriggerHandle = toAreaTriggerHandle(0);
