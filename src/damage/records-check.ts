import type { Blow } from './blow.ts';
import type { DamageTypes } from './damage-types.ts';
import type { Force } from './force.ts';

/**
 * Whether a game's aura types point `blow` and `force` at the framework's records, as the damage system needs: the
 * pipelines hand their records to the aura damage hooks, which the game typed with `G['blow']` and `G['force']`. The
 * system's options type carries this check, so a game whose `blow` is anything else fails to compile.
 */
export type RecordsCheck<G extends DamageTypes> = [Blow<G>] extends [G['blow']]
  ? [Force<G>] extends [G['force']]
    ? unknown
    : {
        /** The game's `force` type must be `Force<Game>`. */
        readonly forceTypeMustBeForceOfTheGame: never;
      }
  : {
      /** The game's `blow` type must be `Blow<Game>`. */
      readonly blowTypeMustBeBlowOfTheGame: never;
    };
