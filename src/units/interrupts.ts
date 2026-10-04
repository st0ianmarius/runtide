import { type Caught, caught, rethrow } from './cleanup.ts';
import { type UnitEngine, unitOf } from './engine.ts';
import type { UnitTypes } from './unit-types.ts';

/**
 * Brings a unit's interrupts in line with its derived states: each interrupting state it entered raises
 * its interrupt on the unit's casts (`spells.interrupt`: a stun pausing or cancelling them) and on its brain (`ai.hold`:
 * its timers held, when the AI system holds for it), and each it left ends it.
 * The aura host's `onTagsChanged` calls it on every tagged aura's edge. Returns how many states it found changed. A cast
 * hook that throws stops nothing: every changed state's casts and brain are told, then the first error surfaces, the
 * later ones suppressed behind it.
 */
export const syncStates = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): number => {
  const unit = unitOf<G>(bearer);
  const list = engine.interrupting;
  const { spells } = engine.options;
  let changed = 0;
  let errors: Caught | undefined;

  for (let i = 0; i < list.length; i++) {
    const state = list[i];
    const bit = 1 << i;

    if (state === undefined || bearer.auras.tags.intersects(state.tags) === ((unit.interrupts & bit) !== 0)) {
      continue;
    }

    unit.interrupts ^= bit;
    changed += 1;

    try {
      if ((unit.interrupts & bit) !== 0) {
        spells.interrupt(bearer, state.reason);
      } else {
        spells.endInterrupt(bearer, state.reason);
      }
    } catch (error) {
      errors = caught(errors, error);
    }

    try {
      // A cast's hooks may have flipped this state again (a nested sync); the brain follows where it ended up.
      engine.options.ai?.hold(bearer, state.reason, (unit.interrupts & bit) !== 0);
    } catch (error) {
      errors = caught(errors, error);
    }
  }

  rethrow(errors);

  return changed;
};
