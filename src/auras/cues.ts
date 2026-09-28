import type { CueId, CueRegistry } from '../cues/index.ts';
import type { AuraChange } from './aura-def.ts';
import type { AuraId, AuraTypes } from './aura-types.ts';
import { CHANGES } from './compile.ts';
import type { AuraRegistry } from './define-auras.ts';

/**
 * The cue an aura declares for a lifecycle change (`AuraDef.cues`), if any: what a client plays when it sees the change
 * on the wire, or a local game fires from the aura event, on the bearer. `undefined` for a retired aura.
 */
export const auraCue = <G extends AuraTypes>(
  auras: AuraRegistry<G>,
  aura: AuraId,
  change: AuraChange,
): CueId | undefined => auras.defs[aura]?.cues?.[change];

/**
 * Checks every aura's lifecycle cues against the game's cue registry at load (§II.6 P7): each a live cue anchored on
 * the bearer (`self` or `entity`), since that is where a client that derives it can place it. Throws a `RangeError`
 * naming the aura and the change.
 */
export const checkAuraCues = <G extends AuraTypes>(auras: AuraRegistry<G>, cues: CueRegistry): void => {
  for (const aura of auras.ids) {
    for (const change of CHANGES) {
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
