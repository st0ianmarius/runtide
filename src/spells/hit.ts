import type { SpellEngine } from './engine.ts';
import type { CastHandle } from './ids.ts';
import type { SpellHit } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';
import { refreshLive } from './take-stats.ts';

/**
 * A delivery of a cast caught units: its hit cue, `onHit` with every unit at once, and the `hit` event.
 * Returns how many of `onHit`'s procs went off; 0 for a stale handle.
 */
export const hitCast = <G extends SpellTypes>(engine: SpellEngine<G>, handle: CastHandle, hit: SpellHit<G>): number => {
  const cast = engine.castOf(handle);

  if (cast === undefined) {
    return 0;
  }

  const def = engine.registry.get(cast.spell);
  const onHit = engine.registry.hooks.onHit[cast.spell];
  const list = engine.takeList();
  let went = 0;

  cast.holds += 1;

  // Held through both, so a hook or cue that throws still lets the cast go.
  try {
    try {
      refreshLive(engine, cast, def);
      engine.fire(cast, def.cues?.hit?.(cast, hit));
      went = onHit === undefined ? 0 : engine.run(cast, onHit(cast, hit, list), list);
    } finally {
      engine.giveList(list);
    }

    engine.raise('hit', cast, hit);
  } finally {
    engine.unhold(cast);
  }

  return went;
};
