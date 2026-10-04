import type { CueId, CueRegistry } from '../cues/index.ts';
import type { AuraCueChange } from './aura-def.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';
import { CHANGES } from './compile.ts';
import type { AuraRegistry } from './define-auras.ts';

/** Every change an aura may declare a cue for: the lifecycle changes, then the finer refreshes a client derives. */
const CUE_CHANGES: readonly AuraCueChange[] = [...CHANGES, 'stacked', 'changed'];

/**
 * The cue an aura declares for a change (`AuraDef.cues`), if any, as declared: what a client plays when it sees the
 * change on the wire (`lifecycleCue` there, which plays `refreshed` for an undeclared `stacked` or `changed`), or a
 * local game fires from the aura event, on the bearer. `undefined` for a retired aura.
 */
export const auraCue = <G extends AuraTypes>(
  auras: AuraRegistry<G>,
  aura: AuraId,
  change: AuraCueChange
): CueId | undefined => auras.defs[aura]?.cues?.[change];

/**
 * Checks every aura's cues against the game's cue registry at load: each a live cue anchored on the bearer (`self` or
 * `entity`), since that is where a client that derives it can place it. Throws a `RangeError` naming the aura and the
 * change. A `stateEntered` cue is local only: the server's own aura events fire it (`auraCue`), and a client never
 * derives it from views, since a state entered leaves nothing in them; it is held to the same rules all the same.
 */
export const checkAuraCues = <G extends AuraTypes>(auras: AuraRegistry<G>, cues: CueRegistry): void => {
  for (const aura of auras.ids) {
    for (const change of CUE_CHANGES) {
      const cue = auraCue(auras, aura, change);

      if (cue === undefined) {
        continue;
      }

      const where = `Aura ${auras.name(aura)}'s ${change} cue`;

      if (cues.schemas[cue] === undefined) {
        throw new RangeError(`${where}: ${cue} is not a live cue id.`);
      }

      if (cues.anchorOf(cue) !== 'self' && cues.anchorOf(cue) !== 'entity') {
        throw new RangeError(`${where}: ${cues.name(cue)} must sit on the bearer (a self or entity cue).`);
      }
    }
  }
};
