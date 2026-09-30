import { type UnitEngine, unitOf } from './engine.ts';
import type { UnitTypes } from './unit-types.ts';

/**
 * Brings a unit's interrupts in line with its derived states: each interrupting state it entered raises
 * its interrupt on the unit's casts (`spells.interrupt`: a stun pausing or cancelling them) and on its brain (`ai.interrupt`:
 * its timers held), and each it left ends it.
 * The aura host's `onTagsChanged` calls it on every tagged aura's edge. Returns how many states it found changed.
 */
export const syncStates = <G extends UnitTypes>(engine: UnitEngine<G>, bearer: G['bearer']): number => {
  const unit = unitOf<G>(bearer);
  const list = engine.interrupting;
  const { spells } = engine.options;
  let changed = 0;

  for (let i = 0; i < list.length; i++) {
    const state = list[i];
    const bit = 1 << i;

    if (state === undefined || bearer.auras.tags.intersects(state.tags) === ((unit.interrupts & bit) !== 0)) {
      continue;
    }

    unit.interrupts ^= bit;
    changed += 1;

    const isOn = (unit.interrupts & bit) !== 0;

    if (isOn) {
      spells.interrupt(bearer, state.reason);
    } else {
      spells.endInterrupt(bearer, state.reason);
    }

    engine.options.ai?.interrupt(bearer, state.reason, isOn);
  }

  return changed;
};
