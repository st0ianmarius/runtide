import type { CueBuffer } from '../cues/index.ts';
import type { Blow } from './blow.ts';
import type { DamageTypes } from './damage-types.ts';
import type { Death } from './death.ts';
import type { Force } from './force.ts';
import type { Heal } from './heal.ts';

/**
 * The cues the pipelines fire (§I.5.3, §II.3.9): the game's own mapping from a finished blow, heal, force or death to
 * cues, since which moments show (a damage number, an absorbed amount, a callout) and with which params is the
 * game's. Each mapping runs at a documented point, before the events of the same outcome, so a trigger's cue answering
 * the event follows it in firing order; it places its cues itself (`fireCue` with the units' positions). Nothing is
 * fired for an outcome the game maps nothing to.
 */
export interface DamageCues<G extends DamageTypes> {
  /** The buffer every mapping fires into. */
  readonly out: CueBuffer;

  /**
   * A blow's cues: in the `outcome` stage, before the `dealt` and `taken` events, for every blow that entered the
   * pipeline (an `ignored` one too, for an immunity callout; never a `skipped` one).
   */
  readonly blow?: (blow: Blow<G>, out: CueBuffer) => void;

  /** A heal's cues: in its `outcome` stage, before the `healed` event, for every heal that was not `skipped`. */
  readonly heal?: (heal: Heal<G>, out: CueBuffer) => void;

  /** A force's cues: after its stages, for every force that was not `skipped` (an `ignored` one too). */
  readonly force?: (force: Force<G>, out: CueBuffer) => void;

  /** A death's cues: first in the death pipeline, before the dead unit's auras hear it; for an inert unit too. */
  readonly death?: (death: Death<G>, out: CueBuffer) => void;
}
